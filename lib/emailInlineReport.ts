export type InlineEmailReport = {
  filename: string;
  sanitizedHtml: string;
  site?: { name: string; url: string };
  status: string;
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeReportHtml(html: string) {
  const allowedTags = new Set([
    'b',
    'blockquote',
    'br',
    'code',
    'div',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'hr',
    'i',
    'li',
    'ol',
    'p',
    'pre',
    'small',
    'span',
    'strong',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'u',
    'ul',
  ]);

  return html
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(iframe|object|embed|svg|canvas|form|input|button|select|textarea|link|meta|img)\b[\s\S]*?>/gi, '')
    .replace(/<\/?(html|head|body)[^>]*>/gi, '')
    .replace(/<([/]?)([a-zA-Z0-9:-]+)(?:\s[^>]*)?>/g, (_match, slash: string, tagName: string) => {
      const tag = String(tagName).toLowerCase();
      if (!allowedTags.has(tag)) return '';
      if (slash) return `</${tag}>`;
      if (tag === 'br' || tag === 'hr') return `<${tag}>`;
      return `<${tag}>`;
    })
    .trim();
}

export function buildInlineReportsHtml(reports: InlineEmailReport[]) {
  if (!reports.length) return '';

  const reportItems = reports
    .map((report, index) => {
      const content =
        report.sanitizedHtml ||
        `<p style="color:#6b7280;">El informe ${escapeHtml(report.filename)} no contiene contenido legible tras el saneado.</p>`;

      return `
        <section style="margin:24px 0;padding:16px;border:1px solid #d1d5db;border-radius:8px;background:#ffffff;">
          <h2 style="margin:0 0 8px;font-size:18px;line-height:1.3;color:#111827;">Informe ${index + 1}: ${escapeHtml(
            report.site?.name || report.filename
          )}</h2>
          <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 12px;font-size:14px;">
            <tbody>
              <tr>
                <td style="padding:4px 8px 4px 0;color:#374151;"><b>Sitio</b></td>
                <td style="padding:4px 0;color:#111827;">${escapeHtml(report.site?.name || 'No especificado')}</td>
              </tr>
              <tr>
                <td style="padding:4px 8px 4px 0;color:#374151;"><b>URL</b></td>
                <td style="padding:4px 0;color:#111827;">${escapeHtml(report.site?.url || 'No especificada')}</td>
              </tr>
              <tr>
                <td style="padding:4px 8px 4px 0;color:#374151;"><b>Estado</b></td>
                <td style="padding:4px 0;color:#111827;">${escapeHtml(report.status)}</td>
              </tr>
              <tr>
                <td style="padding:4px 8px 4px 0;color:#374151;"><b>Archivo origen</b></td>
                <td style="padding:4px 0;color:#111827;">${escapeHtml(report.filename)}</td>
              </tr>
            </tbody>
          </table>
          <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827;">
            ${content}
          </div>
        </section>
      `;
    })
    .join('');

  return `
    <div style="max-width:680px;margin:20px auto 0;">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 12px;color:#111827;">Informes de actualización</h1>
      ${reportItems}
    </div>
  `;
}
