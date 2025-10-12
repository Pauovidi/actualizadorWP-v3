import { NextResponse } from 'next/server';

type Body = {
  url: string;
  token?: string;
  screenshot?: boolean;
  demo?: boolean;
};

export async function POST(req: Request) {
  try {
    const { url, token = '', screenshot = false, demo = false } = (await req.json()) as Body;

    // DEMO → simula
    if (demo) {
      const html = buildDemoReport(url);
      return NextResponse.json({
        ok: true,
        data: {
          status: 'OK',
          errors: [],
          reportHtml: `data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`,
          reportFileName: `informe-${new Date().toISOString().slice(0,10)}.html`,
        },
      });
    }

    // REAL → intenta www / no-www
    const candidates = new Set<string>([url]);
    const u = new URL(url);
    const hostname = u.hostname.replace(/^www\./i, '');
    candidates.add(`${u.protocol}//www.${hostname}`);
    candidates.add(`${u.protocol}//${hostname}`);

    let lastErr: any = null;
    for (const target of candidates) {
      try {
        const resp = await fetch(`${target}/wp-json/maint-agent/v1/update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ screenshot }),
        });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        const payload = await resp.json();

        // payload.htmlReport debe traer el HTML
        const html = payload?.htmlReport || '<html><body>Informe vacío</body></html>';
        return NextResponse.json({
          ok: true,
          data: {
            status: payload?.status || 'OK',
            errors: payload?.errors || [],
            reportHtml: `data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`,
            reportFileName: `informe-${new Date().toISOString().slice(0,10)}.html`,
          },
        });
      } catch (e) {
        lastErr = e;
      }
    }

    throw new Error(`Fallo en todas las variantes de URL: ${String(lastErr)}`);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}

function buildDemoReport(url: string) {
  const now = new Date().toLocaleString('es-ES');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Informe</title>
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
