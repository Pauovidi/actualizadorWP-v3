import { Buffer } from 'node:buffer';
import { NextResponse } from 'next/server';
import { renderReportClassicV1, rowsFromUpdated, errorsBox } from '@/lib/reportTemplate';

export const runtime = 'nodejs';

type Body = {
  url: string;
  token?: string;
  screenshot?: boolean;
  demo?: boolean;
};

function ensureUrl(input: string): URL {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Missing url');
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return new URL(withProto);
}

function baseFromUrl(u: URL): string {
  // Preserve subdir installs (e.g. https://example.com/wp)
  const basePath = (u.pathname || '').replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${basePath}`;
}

async function fetchWithManualRedirect(
  url: string,
  init: RequestInit,
  maxHops = 5,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    const resp = await fetch(current, { ...init, redirect: 'manual' });
    const isRedirect = resp.status >= 300 && resp.status < 400;
    const loc = resp.headers.get('location');
    if (isRedirect && loc) {
      const next = new URL(loc, current).toString();
      console.warn('[api/update] redirect', { from: current, to: next, status: resp.status });
      current = next;
      // NOTE: We intentionally keep method/body/headers so auth is preserved.
      // Many WP setups redirect http->https or www<->non-www.
      continue;
    }
    return resp;
  }
  throw new Error(`Too many redirects while calling ${url}`);
}

export async function POST(req: Request) {
  try {
    const { url, token = '', screenshot = false, demo = false } = (await req.json()) as Body;

    const u = ensureUrl(url);

    // DEMO → simula sin tocar WP
    if (demo) {
      const html = buildDemoReport(u.toString());
      return NextResponse.json({
        ok: true,
        data: {
          status: 'OK',
          errors: [],
          reportHtml: `data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`,
          reportFileName: `informe-${new Date().toISOString().slice(0, 10)}.html`,
        },
      });
    }

    // IMPORTANT:
    // 1) Do not normalize/strip path (supports subdir WP installs)
    // 2) Use the same approach as the known-good legacy app: try input + www/no-www
    // 3) Handle redirects manually to avoid losing auth headers on cross-origin redirects.
    const rawToken = String(token || ''); // do NOT trim/sanitize
    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // The legacy server plugin validates the token from `x-maint-token`.
    // Sending Authorization can trigger WP REST auth and lead to `rest_forbidden` on some installs.
    if (rawToken) {
      authHeaders['x-maint-token'] = rawToken;
    }

    const hostnameBare = u.hostname.replace(/^www\./i, '');
    const basePath = (u.pathname || '').replace(/\/+$/, '');

    const candidates = new Set<string>();
    // 1) exact input (preserve host + path)
    candidates.add(baseFromUrl(u));
    // 2) www / non-www variants (preserve path)
    candidates.add(`${u.protocol}//${hostnameBare}${basePath}`);
    candidates.add(`${u.protocol}//www.${hostnameBare}${basePath}`);

    let lastErr: any = null;

    for (const target of candidates) {
      try {
        const endpoint = `${target}/wp-json/maint-agent/v1/update`;
        console.log('[api/update] trying', { endpoint, hasToken: !!rawToken, screenshot });

        const resp = await fetchWithManualRedirect(
          endpoint,
          {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ screenshot }),
          },
          5,
        );

        const contentType = resp.headers.get('content-type') || '';
        const text = await resp.text();

        console.log('[api/update] wp response', {
          endpoint,
          finalUrl: (resp as any).url || undefined,
          status: resp.status,
          contentType,
        });

        if (!resp.ok) {
          throw new Error(`WP ${resp.status} ${resp.statusText} — ${text.slice(0, 500)}`);
        }

        let payload: any = null;
        if (contentType.includes('application/json')) {
          try {
            payload = JSON.parse(text);
          } catch {
            payload = null;
          }
        }

        const html = buildReportHtmlFromPayload(payload, target);
        return NextResponse.json({
          ok: true,
          data: {
            status: payload?.status || 'OK',
            errors: payload?.errors || [],
            reportHtml: `data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`,
            reportFileName: `informe-${new Date().toISOString().slice(0, 10)}.html`,
          },
        });
      } catch (e: any) {
        lastErr = e;
        console.warn('[api/update] candidate failed', { target, error: String(e?.message || e) });
      }
    }

    throw new Error(`Fallo en todas las variantes de URL: ${String(lastErr?.message || lastErr)}`);
  } catch (err: any) {
    console.error('[api/update] fatal', err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

function buildReportHtmlFromPayload(payload: any, siteUrl: string) {
  // If server already provides an HTML report, use it.
  if (payload?.htmlReport && typeof payload.htmlReport === 'string') return payload.htmlReport;

  const runStarted = new Date().toLocaleString('es-ES');
  const siteName = safeHost(siteUrl);

  const errors: string[] = Array.isArray(payload?.errors) ? payload.errors.map(String) : [];

  // Best case: some plugin versions return a normalized "updated" array already.
  const updated: any[] = Array.isArray(payload?.updated) ? payload.updated : [];
  const steps: any[] = Array.isArray(payload?.steps) ? payload.steps : [];

  // Map plugin payload into the classic report rows.
  // Keep SAME HTML/CSS as legacy reports, but ensure we always have meaningful rows.
  const items = (updated.length ? updated : steps).map((row) => {
    // UPDATED rows usually have: kind/name/from/to/status/note
    if (updated.length) {
      const status = String(row?.status || '').toLowerCase();
      const norm = status === 'ok' || status === 'warn' || status === 'err' ? status : 'ok';
      return {
        kind: String(row?.kind ?? 'plugin'),
        name: String(row?.name ?? row?.slug ?? '—'),
        from: String(row?.from ?? row?.old ?? ''),
        to: String(row?.to ?? row?.new ?? ''),
        status: norm,
        note: String(row?.note ?? row?.msg ?? ''),
      };
    }

    // STEP rows usually have: step/ok/msg
    const ok = row?.ok;
    const status = ok === true ? 'ok' : ok === false ? 'err' : 'warn';
    return {
      kind: 'acción',
      name: String(row?.step ?? row?.name ?? '—'),
      from: '',
      to: '',
      status,
      note: String(row?.msg ?? row?.message ?? ''),
    };
  });

  const okCount = items.filter((it) => it.status === 'ok').length;
  const errCount = items.filter((it) => it.status === 'err').length;
  const warnCount = items.filter((it) => it.status === 'warn').length;

  return renderReportClassicV1({
    siteName,
    siteUrl,
    runStarted,
    okCount,
    warnCount,
    errCount,
    updatesRowsHtml: rowsFromUpdated(items),
    errorsHtml: errorsBox(errors),
  });
}

function safeHost(siteUrl: string) {
  try {
    const u = new URL(siteUrl);
    return u.hostname.replace(/^www\./i, '');
  } catch {
    return siteUrl;
  }
}

function buildDemoReport(url: string) {
  const now = new Date().toLocaleString('es-ES');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Informe DEMO</title>
<style>
  body{font-family:Inter,system-ui,sans-serif;background:#0b1220;color:#e2e8f0;padding:24px}
  .card{background:#0f172a;border:1px solid #334155;border-radius:16px;padding:20px;max-width:900px;margin:0 auto}
  h1{margin:0 0 10px}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{border-bottom:1px solid #1f2937;padding:8px 10px;text-align:left}
</style>
</head>
<body>
  <div class="card">
    <h1>Informe actualización — DEMO</h1>
    <p><b>Sitio:</b> ${url}</p>
    <p><b>Ejecutado:</b> ${now}</p>
    <table>
      <thead><tr><th>Plugin/Tema</th><th>De</th><th>A</th><th>Estado</th></tr></thead>
      <tbody>
        <tr><td>classic-editor</td><td>1.6.4</td><td>1.6.5</td><td>OK</td></tr>
        <tr><td>woocommerce</td><td>9.1.1</td><td>9.2.0</td><td>OK</td></tr>
      </tbody>
    </table>
    <p style="opacity:.7;margin-top:16px">Actualización realizada por Devestial</p>
  </div>
</body></html>`;
}
