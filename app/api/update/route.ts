// app/api/update/route.ts
import { NextRequest, NextResponse } from "next/server";

type Step = { step?: string; ok?: boolean; msg?: string };
type WPResult = {
  status?: string;
  steps?: Step[];
  before?: Record<string, string>;
  after?: Record<string, string>;
  errors?: string[] | string;
  warnings?: string[] | string;
  phpVersion?: string;
  wpVersion?: string;
  dbVersion?: string;
  environment?: string;
  notes?: string;
};

// === Plantilla (versión aprobada) SIN bloque lateral de “Notas” ===
// + Nuevo estado visual .info para “Sin cambios”
const APPROVED_TEMPLATE = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Informe de actualización — {{siteName}}</title>
  <meta name="color-scheme" content="dark light">
  <style>
    :root{
      --bg:#0b1020; --panel:#0f1629; --card:#111a30; --line:#202b45;
      --fg:#e6e9ef; --muted:#9aa7bd; --accent:#0fc2cb; --ok:#22c55e; --warn:#f59e0b; --err:#ef4444;
      --radius:16px; --shadow:0 8px 30px rgba(0,0,0,.25);
    }
    *{box-sizing:border-box}
    html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 ui-sans-serif,system-ui,Segoe UI,Inter,Roboto,Arial}
    .wrap{max-width:1100px;margin:auto;padding:32px}
    .header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}
    h1{font-size:28px;margin:0}
    .kpi{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:18px 0 26px}
    .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .meta div{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px}
    .small{color:var(--muted);font-size:12px}
    .status{display:inline-flex;align-items:center;gap:8px;font-weight:700}
    .dot{width:10px;height:10px;border-radius:50%}
    .ok .dot{background:var(--ok)} .warn .dot{background:var(--warn)} .err .dot{background:var(--err)}
    .info .dot{background:var(--muted)} /* estado neutro: SIN CAMBIOS */
    table{width:100%;border-collapse:collapse;border:1px solid var(--line);border-radius:12px;overflow:hidden}
    th,td{padding:12px 14px;border-bottom:1px solid var(--line);text-align:left}
    th{color:var(--muted);font-weight:600;background:var(--panel)}
    tr:last-child td{border-bottom:0}
    .btn{display:inline-block;padding:8px 14px;border-radius:10px;border:1px solid #28445d;background:#173548;color:#cfeaff;text-decoration:none;font-weight:600}
    .ribbon{position:fixed;top:12px;right:12px;z-index:50}
    .ribbon span{border:1px solid #0fc2cb55;color:#0fc2cb;background:#0fc2cb22;border-radius:12px;padding:6px 10px;font-weight:700}
    .grid{display:grid;grid-template-columns:2fr 1fr;gap:16px}
    @media (max-width:960px){ .grid{grid-template-columns:1fr} .kpi{grid-template-columns:repeat(2,1fr)} }
    @media print{ .btn,.ribbon{display:none} body{background:#fff;color:#111} .card,.meta div{box-shadow:none;border-color:#ddd} .wrap{padding:0} }
  </style>
</head>
<body>
  <div class="ribbon"><span>DEMO</span></div>

  <div class="wrap">
    <div class="header">
      <div>
        <h1>Informe de actualización — {{siteName}}</h1>
        <div class="small">Generado <time id="tstamp"></time> · URL: <a href="{{siteUrl}}" class="btn">{{siteUrl}}</a></div>
      </div>
      <a class="btn" href="{{siteUrl}}" target="_blank" rel="noopener">Abrir sitio</a>
    </div>

    <div class="kpi">
      <div class="card"><div class="small">Estado</div><div class="status {{overallStatusClass}}"><span class="dot"></span>{{overallStatusText}}</div></div>
      <div class="card"><div class="small">Elementos actualizados</div><div style="font-size:18px;font-weight:700">{{updatedCount}} / {{totalCount}}</div></div>
      <div class="card"><div class="small">Advertencias</div><div style="color:#f59e0b;font-weight:700">{{warningsCount}}</div></div>
      <div class="card"><div class="small">Errores</div><div style="color:#ef4444;font-weight:700">{{errorsCount}}</div></div>
    </div>

    <div class="grid">
      <section class="card">
        <h2 style="margin:0 0 8px">Detalles</h2>
        <table>
          <thead><tr><th>Elemento</th><th>De</th><th>A</th><th>Resultado</th><th>Notas</th></tr></thead>
          <tbody>
            <!-- ROWS_DETAILS -->
          </tbody>
        </table>
      </section>

      <aside class="card">
        <h2 style="margin:0 0 8px">Resumen técnico</h2>
        <div class="meta">
          <div><div class="small">PHP</div><div>{{phpVersion}}</div></div>
          <div><div class="small">WP</div><div>{{wpVersion}}</div></div>
          <div><div class="small">Base de datos</div><div>{{dbVersion}}</div></div>
          <div><div class="small">Entorno</div><div>{{environment}}</div></div>
        </div>
      </aside>
    </div>

    <section class="card" style="margin-top:16px">
      <h2 style="margin:0 0 8px">Advertencias & errores</h2>
      <table>
        <thead><tr><th>Tipo</th><th>Mensaje</th><th>Acción sugerida</th></tr></thead>
        <tbody>
          <!-- ROWS_ISSUES -->
        </tbody>
      </table>
    </section>

    <p class="small" style="margin:18px 4px 0">© Actualizador WP — Informe generado automáticamente.</p>
  </div>

  <script>
    document.getElementById("tstamp").textContent = new Date().toLocaleString();
    const inject = (map)=>Object.entries(map).forEach(([k,v])=>{
      document.body.innerHTML=document.body.innerHTML.replaceAll(\`{{\${k}}}\`, v);
    });
    inject({
      siteName:"{{siteName}}", siteUrl:"{{siteUrl}}",
      overallStatusClass:"{{overallStatusClass}}", overallStatusText:"{{overallStatusText}}",
      updatedCount:"{{updatedCount}}", totalCount:"{{totalCount}}",
      warningsCount:"{{warningsCount}}", errorsCount:"{{errorsCount}}",
      phpVersion:"{{phpVersion}}", wpVersion:"{{wpVersion}}", dbVersion:"{{dbVersion}}",
      environment:"{{environment}}"
    });
  </script>
</body>
</html>`;

// === Helpers ===
const htmlEscape = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]!));

const toDataUrlHtml = (html: string) => `data:text/html;base64,${Buffer.from(html, "utf8").toString("base64")}`;
const pickArray = (v: any): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

function computeDiff(before: Record<string, string> | null, after: Record<string, string> | null) {
  const b = before || {};
  const a = after || {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
  const rows = keys.map((k) => {
    const v1 = (b[k] ?? "").trim();
    const v2 = (a[k] ?? "").trim();
    const changed = v1 !== v2;
    return { item: k, from: v1 || "—", to: v2 || "—", changed };
  });
  const updated = rows.filter((r) => r.changed);
  return { rows, updated, total: rows.length, updatedCount: updated.length };
}

function statusToClassText(statusOk: boolean, warningsCount: number, errorsCount: number) {
  if (errorsCount > 0) return { klass: "err", text: "Errores detectados" };
  if (!statusOk) return { klass: "err", text: "Actualizado con errores" };
  if (warningsCount > 0) return { klass: "warn", text: "Actualizado con incidencias" };
  return { klass: "ok", text: "OK" };
}

// Sugerencias sin “miniaturas”
const suggestionFor = (type: "warn" | "error", msg: string) => {
  const m = msg || "";
  if (/miniatura/i.test(m) || /thumbnail/i.test(m)) return "Revisión manual";
  return type === "warn" ? "Revisión manual" : "Revisar logs o reintentar desde panel/CLI";
};

function fillTemplatewithData(tpl: string, data: {
  siteName: string; siteUrl: string;
  overallStatusClass: string; overallStatusText: string;
  updatedCount: number; totalCount: number;
  warningsCount: number; errorsCount: number;
  phpVersion: string; wpVersion: string; dbVersion: string; environment: string;
  detailsRowsHtml: string; issuesRowsHtml: string; mode: "demo" | "real";
}) {
  let html = tpl;
  const map: Record<string, string | number> = {
    siteName: data.siteName,
    siteUrl: data.siteUrl,
    overallStatusClass: data.overallStatusClass,
    overallStatusText: data.overallStatusText,
    updatedCount: data.updatedCount,
    totalCount: data.totalCount,
    warningsCount: data.warningsCount,
    errorsCount: data.errorsCount,
    phpVersion: data.phpVersion || "—",
    wpVersion: data.wpVersion || "—",
    dbVersion: data.dbVersion || "—",
    environment: data.environment || "—",
  };
  for (const [k, v] of Object.entries(map)) html = html.replaceAll(`{{${k}}}`, String(v));

  html = html.replace(/<!-- ROWS_DETAILS -->[\s\S]*?<\/tbody>/, `<!-- ROWS_DETAILS -->\n${data.detailsRowsHtml}\n</tbody>`);
  html = html.replace(/<!-- ROWS_ISSUES -->[\s\S]*?<\/tbody>/, `<!-- ROWS_ISSUES -->\n${data.issuesRowsHtml}\n</tbody>`);
  if (data.mode === "real") html = html.replace(/<div class="ribbon">[\s\S]*?<\/div>/, "");
  return html;
}

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const payload = raw ? JSON.parse(raw) : {};
    const sites: Array<{ name?: string; url?: string; token?: string; email?: string }> =
      Array.isArray(payload?.sites) ? payload.sites : [];

    if (!sites.length) return NextResponse.json({ ok: false, error: "Missing sites" }, { status: 400 });

    const results: any[] = [];
    const MODE = (process.env.NEXT_PUBLIC_MODE || process.env.MODE || "real").toString().toLowerCase() === "demo" ? "demo" : "real";

    for (const s of sites) {
      const siteName = String(s?.name ?? "Sitio");
      const siteUrl = String(s?.url ?? "").replace(/\/+$/, "");
      const token = String(s?.token ?? "");

      if (!siteUrl || !token) { results.push({ status: "ERROR", errors: ["Missing siteUrl/token"] }); continue; }

      const resp = await fetch(`${siteUrl}/wp-json/maint-agent/v1/update`, {
        method: "POST",
        headers: { Accept: "application/json", "User-Agent": "wp-maint-agent/ui", "X-MAINT-TOKEN": token },
      });

      const txt = await resp.text();
      const data: WPResult = (() => { try { return JSON.parse(txt) } catch { return {} as WPResult } })();

      const statusStr = String(data?.status ?? (resp.ok ? "ok" : "error")).toLowerCase();
      const statusOk = statusStr === "ok";
      const before = (data?.before && typeof data.before === "object") ? data.before : null;
      const after  = (data?.after  && typeof data.after  === "object") ? data.after  : null;
      const diff = computeDiff(before, after);

      const errors = pickArray(data?.errors);
      const warnings = pickArray(data?.warnings);
      const { klass, text } = statusToClassText(statusOk, warnings.length, errors.length);

      // Filas Detalles — SIN CAMBIOS = INFO (gris)
      const classify = (k: string, from: string, to: string) => {
        if (from !== to) {
          return { cls: "ok",   label: "OK",          note: "Actualización completada." };
        }
        return { cls: "info", label: "Sin cambios", note: "Ya estaba al día." };
        // si lo quieres verde: return { cls: "ok", label: "OK", note: "Sin cambios (ya estaba al día)." };
      };

      const detailsRowsHtml = diff.rows.length
        ? diff.rows.map(r => {
            const { cls, label, note } = classify(r.item, r.from, r.to);
            return `<tr>
  <td>${htmlEscape(r.item)}</td>
  <td>${htmlEscape(r.from)}</td>
  <td>${htmlEscape(r.to)}</td>
  <td><span class="status ${cls}"><span class="dot"></span>${label}</span></td>
  <td>${htmlEscape(note)}</td>
</tr>`;
          }).join("\n")
        : `<tr><td colspan="5" class="small">No se detectaron elementos.</td></tr>`;

      // Filas Incidencias (solo las reales; sin “miniaturas” en sugerencias)
      const issueWarnRows = warnings.map((w) => `<tr>
  <td><span class="status warn"><span class="dot"></span>WARN</span></td>
  <td>${htmlEscape(w)}</td>
  <td>${htmlEscape(suggestionFor("warn", w))}</td>
</tr>`);

      const issueErrorRows = errors.map((e) => `<tr>
  <td><span class="status err"><span class="dot"></span>ERROR</span></td>
  <td>${htmlEscape(e)}</td>
  <td>${htmlEscape(suggestionFor("error", e))}</td>
</tr>`);

      const issuesRowsHtml = (issueWarnRows.concat(issueErrorRows).join("\n")) || `<tr><td colspan="3" class="small">Sin incidencias.</td></tr>`;

      const phpVersion = String(data?.phpVersion ?? "");
      const wpVersion  = String(data?.wpVersion ?? (after?.core || ""));
      const dbVersion  = String(data?.dbVersion ?? "");
      const environment = String(data?.environment ?? "Producción");

      const html = fillTemplatewithData(APPROVED_TEMPLATE, {
        siteName, siteUrl,
        overallStatusClass: klass, overallStatusText: text,
        updatedCount: diff.updatedCount, totalCount: diff.total,
        warningsCount: warnings.length, errorsCount: errors.length,
        phpVersion: phpVersion || "—", wpVersion: wpVersion || "—", dbVersion: dbVersion || "—",
        environment,
        detailsRowsHtml, issuesRowsHtml,
        mode: MODE,
      });

      const reportUrl = toDataUrlHtml(html);
      const reportFileName = `informe-${new Date().toISOString().slice(0,10)}.html`;

      results.push({
        status: errors.length ? "ERROR" : (warnings.length ? "WARN" : (statusOk ? "OK" : "ERROR")),
        errors,
        reportUrl,
        reportFileName,
      });
    }

    return NextResponse.json({ ok: true, results }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
