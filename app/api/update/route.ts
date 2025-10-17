// app/api/update/route.ts
import { NextRequest, NextResponse } from "next/server";

/** Utils */
function safeJson<T = any>(txt: string | null): T | null {
  if (!txt) return null;
  try { return JSON.parse(txt) as T; } catch { return null; }
}

function b64DataUrl(html: string) {
  const b64 = Buffer.from(html, "utf8").toString("base64");
  return `data:text/html;base64,${b64}`;
}

type SiteIn = { name?: string; url?: string; token?: string; email?: string };

// Diff versiones (como en el CLI): compara before/after y devuelve array de items cambiados
function computeUpdates(before: Record<string,string>|null, after: Record<string,string>|null) {
  const b = before || {};
  const a = after || {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
  const out: Array<{item:string; from?:string; to?:string}> = [];
  for (const k of keys) {
    const v1 = (b[k] ?? "").trim();
    const v2 = (a[k] ?? "").trim();
    if (v1 !== v2) out.push({ item: k, from: v1 || undefined, to: v2 || undefined });
  }
  return out;
}

/** Plantilla aprobada (oscura, compacta) */
function makeReportHtml(site: {name:string; url:string}, result: any) {
  const status = String(result.status ?? "ok").toLowerCase();
  const ok = status === "ok";
  const steps = Array.isArray(result.steps) ? result.steps : [];
  const errors = Array.isArray(result.errors) ? result.errors : (result.errors ? [String(result.errors)] : []);
  const before = result.before && typeof result.before === "object" ? result.before : null;
  const after  = result.after  && typeof result.after  === "object" ? result.after  : null;
  const updates = computeUpdates(before, after);

  const li = (arr: string[]) => arr.length ? arr.map(x=>`<li>${x}</li>`).join("") : `<li>—</li>`;
  const liSteps = steps.length
    ? steps.map((s:any)=>`<li><strong>${s.step || "paso"}</strong>: ${s.ok ? "ok" : "error"}${s.msg ? ` — <span class="muted">${s.msg}</span>`:""}</li>`).join("")
    : `<li>—</li>`;

  const rowsUpdates = updates.length
    ? updates.map(u=>`
      <tr>
        <td>${u.item}</td>
        <td class="muted">${u.from ?? "—"}</td>
        <td>${u.to ?? "—"}</td>
      </tr>`).join("")
    : `<tr><td colspan="3" class="muted">No hay cambios</td></tr>`;

  const when = new Date().toISOString().replace("T"," ").slice(0,19);

  return `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<title>Informe · ${site.name}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {
    --bg:#0b1220; --card:#111a2c; --border:#1d2a44; --text:#e6eef8; --muted:#a8b3cf;
    --ok:#89d07e; --bad:#ff7b7b; --chip:#1b2944;
  }
  html,body{background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0}
  .wrap{max-width:920px;margin:32px auto;padding:0 16px}
  h1{font-size:28px;margin:0 0 8px}
  h2{font-size:18px;margin:0 0 10px}
  .muted{color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;margin:16px 0}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .status{display:inline-block;padding:4px 10px;border-radius:999px;font-weight:600;background:var(--chip)}
  .status[data-ok="true"]{color:var(--ok)} .status[data-ok="false"]{color:var(--bad)}
  table{width:100%;border-collapse:collapse}
  th,td{padding:10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
  th{color:#fff}
  code{padding:2px 6px;background:var(--chip);border-radius:6px}
  a{color:#82c3ff;text-decoration:none}
</style>
<div class="wrap">
  <h1>Informe de actualización</h1>
  <p class="muted">Generado: <time>${when}</time></p>

  <div class="card">
    <div class="grid">
      <div>
        <h2>Sitio</h2>
        <p><strong>${site.name}</strong><br><a href="${site.url}">${site.url}</a></p>
      </div>
      <div>
        <h2>Estado</h2>
        <p><span class="status" data-ok="${ok}">${ok ? "OK" : "ERROR"}</span></p>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Pasos ejecutados</h2>
    <ul>${liSteps}</ul>
  </div>

  <div class="card">
    <h2>Componentes actualizados</h2>
    <table>
      <thead><tr><th>Elemento</th><th>Antes</th><th>Después</th></tr></thead>
      <tbody>${rowsUpdates}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>Errores</h2>
    <ul>${li(errors.map(String))}</ul>
  </div>
</div>
</html>`;
}

/** Handler App Router */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const parsed = safeJson<{sites: SiteIn[]}>(body) || { sites: [] };
    const sites = Array.isArray(parsed.sites) ? parsed.sites : [];

    if (!sites.length) {
      return NextResponse.json({ ok: false, error: "Missing sites" }, { status: 400 });
    }

    const results: any[] = [];

    for (const raw of sites) {
      const site = {
        name: String(raw?.name ?? "Sitio"),
        url:  String(raw?.url ?? "").replace(/\/+$/,""),
        token:String(raw?.token ?? ""),
        email:String(raw?.email ?? ""),
      };

      if (!site.url || !site.token) {
        results.push({ status: "ERROR", errors: ["Missing siteUrl/token"] });
        continue;
      }

      const endpoint = `${site.url}/wp-json/maint-agent/v1/update`;

      // === Llamada al WP (igual que el CLI): header X-MAINT-TOKEN, sin body ===
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "User-Agent": "wp-maint-agent/ui",
          "X-MAINT-TOKEN": site.token,
        },
      });

      const txt = await resp.text();
      const data: any = safeJson(txt) ?? {};

      // Normalizamos como en el CLI
      const status = String(data.status ?? (resp.ok ? "ok" : "error")).toLowerCase();
      const norm = {
        status,
        steps: data.steps ?? [],
        errors: data.errors ?? (resp.ok ? [] : [`HTTP ${resp.status}`]),
        before: data.before ?? null,
        after:  data.after ?? null,
      };

      // Generar HTML y data URL
      const html = makeReportHtml({ name: site.name, url: site.url }, norm);
      const reportUrl = b64DataUrl(html);
      const reportFileName = `informe-${new Date().toISOString().slice(0,10)}.html`;

      results.push({
        status: status === "ok" ? "OK" : "ERROR",
        errors: Array.isArray(norm.errors) ? norm.errors.map(String) : (norm.errors ? [String(norm.errors)] : []),
        reportUrl,
        reportFileName,
        message: data.notes || undefined,
      });
    }

    return NextResponse.json({ ok: true, results }, { status: 200 });
  } catch (err: any) {
    console.error("update api error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

// (Opcional) fuerza runtime Node para Buffer
export const runtime = "nodejs";
