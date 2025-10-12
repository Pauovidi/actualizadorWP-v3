export function renderReportClassicV1(params: {
  siteName: string;
  siteUrl: string;
  runStarted: string;
  okCount: number;
  warnCount: number;
  errCount: number;
  updatesRowsHtml: string;
  errorsHtml: string;
  previewImg?: string;
  logoDataUri?: string;
}): string {
  const { siteName, siteUrl, runStarted, okCount, warnCount, errCount, updatesRowsHtml, errorsHtml, previewImg, logoDataUri } = params;
  const previewBlock = previewImg ? `<div class="site-preview"><img class="ph" src="${previewImg}" alt="Vista previa" /></div>` : "";
  const footerLogo = logoDataUri ? `<img src="${logoDataUri}" alt="Devestial" />` : `<strong>Devestial</strong>`;
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Informe de actualización — ${escapeHtml(siteName)}</title>
  <style>
    :root{ --bg:#ffffff; --fg:#0f172a; --muted:#6b7280; --line:#e5e7eb; --ok:#16a34a; --warn:#f59e0b; --err:#ef4444; --accent:#111827; --card:#f8fafc; }
    @media (prefers-color-scheme: dark){ :root{ --bg:#0b1020; --fg:#e5e7eb; --muted:#94a3b8; --line:#1f2937; --ok:#22c55e; --warn:#fbbf24; --err:#f87171; --accent:#e2e8f0; --card:#111827; } }
    html,body{ background:var(--bg); color:var(--fg); font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif; margin:0; }
    .wrap{ max-width: 1120px; margin: 40px auto; padding: 0 20px; }
    .topgrid{ display:grid; grid-template-columns: 1fr 340px; gap:20px; align-items:start; }
    @media (max-width: 900px){ .topgrid{ grid-template-columns: 1fr; } }
    header{ display:flex; flex-direction:column; gap:8px; margin-bottom: 10px; }
    header h1{ font-size: 28px; margin:0; font-weight: 800; letter-spacing:-0.01em; }
    header .meta{ color: var(--muted); font-size: 13px; }
    .summary{ display:flex; gap:10px; flex-wrap:wrap; margin: 18px 0 10px; }
    .pill{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px 14px; display:flex; align-items:center; gap:10px; }
    .pill .dot{ width:10px; height:10px; border-radius:50%; display:inline-block; }
    .pill.ok .dot{ background:var(--ok); } .pill.warn .dot{ background:var(--warn); } .pill.err .dot{ background:var(--err); }
    h2{ font-size: 18px; margin: 26px 0 12px; border-bottom:1px solid var(--line); padding-bottom:8px; }
    table{ width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
    thead th{ text-align:left; font-size:12px; color:var(--muted); background: rgba(0,0,0,0.03); padding:10px 12px; }
    tbody td{ padding:12px; border-top:1px solid var(--line); vertical-align: top; }
    .badge{ display:inline-block; font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid var(--line); background:var(--bg); }
    .status.ok{ color:var(--ok); font-weight:600; } .status.warn{ color:var(--warn); font-weight:600; } .status.err{ color:var(--err); font-weight:600; }
    .muted{ color:var(--muted); }
    .site-preview{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:10px; }
    .site-preview .ph{ width:100%; aspect-ratio: 4/3; object-fit: cover; border-radius:10px; display:block; }
    footer{ margin: 30px 0 10px; color: var(--muted); font-size:12px; text-align:center; }
    a{ color:inherit; }
    .brand{ display:inline-flex; align-items:center; gap:8px; margin-left:8px; }
    .brand img{ height:22px; width:auto; vertical-align:middle; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topgrid">
      <div>
        <header>
          <h1>Informe de actualización</h1>
          <div class="meta">
            <strong>${escapeHtml(siteName)}</strong> — <a href="${escapeHtml(siteUrl)}">${escapeHtml(siteUrl)}</a><br/>
            Ejecutado: ${escapeHtml(runStarted)}
          </div>
        </header>
        <section class="summary">
          <div class="pill ok"><span class="dot"></span><div><div><strong>OK</strong></div><div class="muted">${okCount} acciones correctas</div></div></div>
          <div class="pill warn"><span class="dot"></span><div><div><strong>Advertencias</strong></div><div class="muted">${warnCount} posibles incidencias</div></div></div>
          <div class="pill err"><span class="dot"></span><div><div><strong>Errores</strong></div><div class="muted">${errCount} fallos</div></div></div>
        </section>
      </div>
      <aside>
        ${previewBlock}
      </aside>
    </div>

    <section>
      <h2>Actualizaciones</h2>
      <table>
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Nombre</th>
            <th>Versión</th>
            <th>Estado</th>
            <th>Nota</th>
          </tr>
        </thead>
        <tbody>
          ${updatesRowsHtml}
        </tbody>
      </table>
    </section>

    <section>
      <h2>Errores</h2>
      ${errorsHtml}
    </section>

    <footer>
      <span class="muted">Actualización realizada por</span>
      <span class="brand">${footerLogo}</span>
    </footer>
  </div>
</body>
</html>`;
}

export function rowsFromUpdated(items: any[]): string {
  if (!items || !items.length) {
    return "<tr><td colspan='5' class='muted'>No se realizaron actualizaciones.</td></tr>";
  }
  return items.map((it) => {
    const kind = escapeHtml(it.kind || "item");
    const name = escapeHtml(it.name || it.slug || "—");
    const vfrom = it.from || ""; const vto = it.to || "";
    const version = vfrom && vto ? `${vfrom} → ${vto}` : (vfrom || vto || "-");
    const status = (it.status || "ok").toLowerCase();
    const statusCls = status === "ok" ? "ok" : status === "warn" ? "warn" : "err";
    const note = escapeHtml(it.note || "");
    return `<tr>
      <td><span class='badge ${kind}'>${kind}</span></td>
      <td><strong>${name}</strong></td>
      <td class='muted'>${escapeHtml(version)}</td>
      <td class='status ${statusCls}'>${status.toUpperCase()}</td>
      <td>${note}</td>
    </tr>`;
  }).join("\n");
}

export function errorsBox(errors: string[]): string {
  if (!errors || !errors.length) return "<div class='muted'>Sin errores reportados.</div>";
  const lis = errors.map(e => `<li>${escapeHtml(e)}</li>`).join("\n");
  return `<div class='errors-box'><strong>Se han detectado errores:</strong><ul>${lis}</ul></div>`;
}

function escapeHtml(s: string){
  return s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c] as string));
}
