// app/api/update/route.ts
import { NextRequest, NextResponse } from "next/server";

/* ============================================================
   PLANTILLA APROBADA (CONGELADA) — NO MODIFICAR SIN VERSIONAR
   Versión: v1.0.0-approved-2025-10-17
   ============================================================ */

type Step = { step?: string; ok?: boolean; msg?: string };
type UpdateRow = { item: string; from?: string; to?: string };

type ApprovedReportInput = {
  site: { name: string; url: string };
  statusOk: boolean;                // true => OK, false => ERROR
  generatedAtISO: string;           // 2025-10-17T15:23:35Z
  steps: Step[];
  updates: UpdateRow[];
  errors: string[];
};

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, '&quot;')
    .replace(/'/g, "&#39;");
}

function fmtDateLocal(iso: string) {
  // YYYY-MM-DD HH:mm:ss (igual que el ejemplo aprobado)
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function renderApprovedReport(input: ApprovedReportInput) {
  const { site, statusOk, generatedAtISO } = input;

  const stepsHtml = input.steps?.length
    ? input.steps
        .map((s) => {
          const name = esc(s.step || "paso");
          const okStr = s.ok ? "ok" : "error";
          const msg = s.msg ? ` — <span class="muted">${esc(s.msg)}</span>` : "";
          return `<li><strong>${name}</strong>: ${okStr} ${msg}</li>`;
        })
        .join("")
    : "<li>—</li>";

  const rowsUpdates = input.updates?.length
    ? input.updates
        .map(
          (u) => `
        <tr>
          <td>${esc(u.item)}</td>
          <td class="muted">${u.from ? esc(u.from) : "—"}</td>
          <td>${u.to ? esc(u.to) : "—"}</td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="3" class="muted">No hay cambios</td></tr>`;

  const errorsHtml = input.errors?.length
    ? input.errors.map((e) => `<li>${esc(e)}</li>`).join("")
    : "<li>—</li>";

  // HTML/CSS OSCURO CONGELADO (idéntico al aprobado)
  return `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<title>Informe · ${esc(site.name)}</title>
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
  <p class="muted">Generado: <time>${fmtDateLocal(generatedAtISO)}</time></p>

  <div class="card">
    <div class="grid">
      <div>
        <h2>Sitio</h2>
        <p><strong>${esc(site.name)}</strong><br><a href="${esc(site.url)}">${esc(site.url)}</a></p>
      </div>
      <div>
        <h2>Estado</h2>
        <p><span class="status" data-ok="${statusOk ? "true" : "false"}">${statusOk ? "OK" : "ERROR"}</span></p>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Pasos ejecutados</h2>
    <ul>${stepsHtml}</ul>
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
    <ul>${errorsHtml}</ul>
  </div>
</div>
</html>`;
}

/* ============================
   Utils de la API
   ============================ */

function safeJson<T = any>(txt: string | null): T | null {
  if (!txt) return null;
  try {
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

function computeUpdates(
  before: Record<string, string> | null,
  after: Record<string, string> | null
): UpdateRow[] {
  const b = before || {};
  const a = after || {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
  const out: UpdateRow[] = [];
  for (const k of keys) {
    const v1 = (b[k] ?? "").trim();
    const v2 = (a[k] ?? "").trim();
    if (v1 !== v2) out.push({ item: k, from: v1 || undefined, to: v2 || undefined });
  }
  return out;
}

function toDataUrlHtml(html: string) {
  const b64 = Buffer.from(html, "utf8").toString("base64");
  return `data:text/html;base64,${b64}`;
}

/* ============================
   Handler App Router
   ============================ */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const bodyTxt = await req.text();
    const payload = safeJson<{ sites: Array<{ name?: string; url?: string; token?: string; email?: string }> }>(bodyTxt) || { sites: [] };
    const sites = Array.isArray(payload.sites) ? payload.sites : [];

    if (!sites.length) {
      return NextResponse.json({ ok: false, error: "Missing sites" }, { status: 400 });
    }

    const results: any[] = [];

    for (const s of sites) {
      const site = {
        name: String(s?.name ?? "Sitio"),
        url: String(s?.url ?? "").replace(/\/+$/, ""),
        token: String(s?.token ?? ""),
      };

      if (!site.url || !site.token) {
        results.push({ status: "ERROR", errors: ["Missing siteUrl/token"] });
        continue;
      }

      // Llamada al WP (misma lógica que el CLI): header X-MAINT-TOKEN, sin body
      const endpoint = `${site.url}/wp-json/maint-agent/v1/update`;
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "User-Agent": "wp-maint-agent/ui",
          "X-MAINT-TOKEN": site.token,
        },
      });

      const txt = await resp.text();
      const data: any = safeJson(txt) ?? {};

      const statusStr = String(data?.status ?? (resp.ok ? "ok" : "error")).toLowerCase();
      const statusOk = statusStr === "ok";

      const steps: Step[] = Array.isArray(data?.steps) ? data.steps : [];
      const before = data?.before && typeof data.before === "object" ? (data.before as Record<string, string>) : null;
      const after = data?.after && typeof data.after === "object" ? (data.after as Record<string, string>) : null;

      const updates = computeUpdates(before, after);

      const errors: string[] = Array.isArray(data?.errors)
        ? data.errors.map((x: any) => String(x))
        : data?.errors
        ? [String(data.errors)]
        : [];

      // Render con la PLANTILLA APROBADA (congelada)
      const html = renderApprovedReport({
        site: { name: site.name, url: site.url },
        statusOk,
        generatedAtISO: new Date().toISOString(),
        steps,
        updates,
        errors,
      });

      const reportUrl = toDataUrlHtml(html);
      const reportFileName = `informe-${new Date().toISOString().slice(0, 10)}.html`;

      results.push({
        status: statusOk ? "OK" : "ERROR",
        errors,
        reportUrl,
        reportFileName,
      });
    }

    return NextResponse.json({ ok: true, results }, { status: 200 });
  } catch (e: any) {
    console.error("update api error:", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
