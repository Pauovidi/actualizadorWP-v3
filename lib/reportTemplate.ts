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
  heading?: string;
  executiveSummaryHtml?: string;
  issuesHeading?: string;
}): string {
  const {
    siteName,
    siteUrl,
    runStarted,
    okCount,
    warnCount,
    errCount,
    updatesRowsHtml,
    errorsHtml,
    previewImg,
    logoDataUri,
    heading = 'Informe de actualización',
    executiveSummaryHtml = '',
    issuesHeading = 'Errores y advertencias',
  } = params;
  const previewBlock = previewImg
    ? `<div style="border:1px solid #e5e7eb;border-radius:12px;padding:10px;background:#f8fafc;"><img style="width:100%;max-width:280px;height:auto;border-radius:8px;display:block;" src="${previewImg}" alt="Vista previa" /></div>`
    : '';
  const footerLogo = logoDataUri ? `<img src="${logoDataUri}" alt="Devestial" />` : '<strong>Devestial</strong>';
  const generalStatus =
    errCount > 0
      ? 'Actualización completada con errores'
      : warnCount > 0
        ? 'Actualización completada con advertencias'
        : 'Actualización completada correctamente';
  const statusColor = errCount > 0 ? '#b91c1c' : warnCount > 0 ? '#92400e' : '#166534';
  const statusBg = errCount > 0 ? '#fef2f2' : warnCount > 0 ? '#fffbeb' : '#f0fdf4';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Informe de actualización — ${escapeHtml(siteName)}</title>
</head>
<body style="margin:0;background:#ffffff;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">
  <div style="max-width:760px;margin:0 auto;padding:24px 16px;">
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;">
      <tbody>
        <tr>
          <td style="vertical-align:top;padding:0 0 12px;">
            <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;color:#111827;font-weight:700;">${escapeHtml(heading)}</h1>
            <table role="presentation" style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;">
              <tbody>
                <tr>
                  <td style="padding:14px;">
                    <p style="margin:0 0 6px;color:#111827;"><strong>${escapeHtml(siteName)}</strong></p>
                    <p style="margin:0 0 6px;color:#374151;">${escapeHtml(siteUrl)}</p>
                    <p style="margin:0 0 6px;color:#374151;"><strong>Fecha de actualización:</strong> ${escapeHtml(runStarted)}</p>
                    <p style="margin:10px 0 0;padding:8px 10px;border-radius:8px;background:${statusBg};color:${statusColor};font-weight:700;">${generalStatus}</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
        ${previewBlock ? `<tr><td style="padding:0 0 12px;">${previewBlock}</td></tr>` : ''}
      </tbody>
    </table>

    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tbody>
        <tr>
          <td style="width:33.33%;padding:10px;border:1px solid #dcfce7;background:#f0fdf4;color:#166534;"><strong>OK</strong><br/>${okCount} acciones correctas</td>
          <td style="width:33.33%;padding:10px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;"><strong>Advertencias</strong><br/>${warnCount} posibles incidencias</td>
          <td style="width:33.33%;padding:10px;border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;"><strong>Errores</strong><br/>${errCount} fallos</td>
        </tr>
      </tbody>
    </table>

    <section style="margin:0 0 22px;">
      <h2 style="font-size:18px;margin:0 0 10px;color:#111827;">Resumen ejecutivo</h2>
      ${
        executiveSummaryHtml ||
        `<p style="margin:0;color:#374151;">${generalStatus}.</p>`
      }
    </section>

    <section style="margin:0 0 22px;">
      <h2 style="font-size:18px;margin:0 0 10px;color:#111827;">Actualizaciones</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;background:#ffffff;font-size:13px;">
        <thead>
          <tr>
            <th style="width:12%;padding:10px 8px;text-align:left;background:#f3f4f6;color:#374151;border-bottom:1px solid #e5e7eb;">Tipo</th>
            <th style="width:24%;padding:10px 8px;text-align:left;background:#f3f4f6;color:#374151;border-bottom:1px solid #e5e7eb;">Nombre</th>
            <th style="width:16%;padding:10px 8px;text-align:left;background:#f3f4f6;color:#374151;border-bottom:1px solid #e5e7eb;">Versión anterior</th>
            <th style="width:16%;padding:10px 8px;text-align:left;background:#f3f4f6;color:#374151;border-bottom:1px solid #e5e7eb;">Versión nueva</th>
            <th style="width:12%;padding:10px 8px;text-align:left;background:#f3f4f6;color:#374151;border-bottom:1px solid #e5e7eb;">Estado</th>
            <th style="width:20%;padding:10px 8px;text-align:left;background:#f3f4f6;color:#374151;border-bottom:1px solid #e5e7eb;">Nota</th>
          </tr>
        </thead>
        <tbody>
          ${updatesRowsHtml}
        </tbody>
      </table>
    </section>

    <section style="margin:0 0 22px;">
      <h2 style="font-size:18px;margin:0 0 10px;color:#111827;">${escapeHtml(issuesHeading)}</h2>
      ${errorsHtml}
    </section>

    <footer style="margin:28px 0 0;color:#6b7280;font-size:12px;text-align:center;">
      <span>Actualización realizada por</span>
      <span style="display:inline-block;margin-left:6px;">${footerLogo}</span>
    </footer>
  </div>
</body>
</html>`;
}

export function rowsFromUpdated(items: any[]): string {
  if (!items || !items.length) {
    return "<tr><td colspan='6' style='padding:12px;color:#6b7280;border-top:1px solid #e5e7eb;'>No se realizaron actualizaciones.</td></tr>";
  }

  return items
    .map((it) => {
      const kind = String(it.kind || 'item').toLowerCase();
      const kindLabel = kind === 'core' ? 'Núcleo' : kind === 'theme' ? 'Tema' : kind === 'plugin' ? 'Plugin' : escapeHtml(kind);
      const name = escapeHtml(it.name || it.slug || '—');
      const previousVersion = escapeHtml(it.from || it.old || '-');
      const newVersion = escapeHtml(it.to || it.new || '-');
      const status = String(it.status || 'ok').toLowerCase();
      const statusLabel = status === 'warn' ? 'Advertencia' : status === 'err' ? 'Error' : 'OK';
      const statusColor = status === 'warn' ? '#92400e' : status === 'err' ? '#b91c1c' : '#166534';
      const statusBg = status === 'warn' ? '#fffbeb' : status === 'err' ? '#fef2f2' : '#f0fdf4';
      const note = escapeHtml(it.note || '');

      return `<tr>
      <td style="padding:10px 8px;border-top:1px solid #e5e7eb;vertical-align:top;color:#374151;">${kindLabel}</td>
      <td style="padding:10px 8px;border-top:1px solid #e5e7eb;vertical-align:top;color:#111827;font-weight:700;word-break:normal;">${name}</td>
      <td style="padding:10px 8px;border-top:1px solid #e5e7eb;vertical-align:top;color:#374151;white-space:nowrap;">${previousVersion}</td>
      <td style="padding:10px 8px;border-top:1px solid #e5e7eb;vertical-align:top;color:#374151;white-space:nowrap;">${newVersion}</td>
      <td style="padding:10px 8px;border-top:1px solid #e5e7eb;vertical-align:top;"><span style="display:inline-block;padding:3px 8px;border-radius:999px;background:${statusBg};color:${statusColor};font-weight:700;">${statusLabel}</span></td>
      <td style="padding:10px 8px;border-top:1px solid #e5e7eb;vertical-align:top;color:#374151;">${note}</td>
    </tr>`;
    })
    .join('\n');
}

export function errorsBox(errors: string[]): string {
  if (!errors || !errors.length) {
    return "<div style='padding:12px;border:1px solid #e5e7eb;background:#f8fafc;color:#374151;border-radius:10px;'>Sin errores ni advertencias.</div>";
  }
  const lis = errors.map((e) => `<li style="margin:0 0 6px;">${escapeHtml(e)}</li>`).join('\n');
  return `<div style='padding:12px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:10px;'><strong>Se han detectado advertencias:</strong><ul style="margin:8px 0 0;padding-left:18px;">${lis}</ul></div>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] as string
  );
}
