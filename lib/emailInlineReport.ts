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

function sanitizeInlineStyle(value: string) {
  const cleaned = value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((rule) => rule.trim())
    .filter(Boolean)
    .filter((rule) => !/url\s*\(|expression\s*\(|javascript:|@import/i.test(rule))
    .join(';');
  return cleaned ? ` style="${escapeHtml(cleaned)}"` : '';
}

function withoutLeadingHeading(html: string) {
  return html.replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>\s*/i, '');
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
    .replace(/<([/]?)([a-zA-Z0-9:-]+)([^>]*)?>/g, (_match, slash: string, tagName: string, rawAttrs: string) => {
      const tag = String(tagName).toLowerCase();
      if (!allowedTags.has(tag)) return '';
      if (slash) return `</${tag}>`;
      if (tag === 'br' || tag === 'hr') return `<${tag}>`;
      const styleMatch = String(rawAttrs || '').match(/\sstyle=(["'])(.*?)\1/i);
      return `<${tag}${styleMatch ? sanitizeInlineStyle(styleMatch[2]) : ''}>`;
    })
    .trim();
}

export function buildInlineReportsHtml(reports: InlineEmailReport[]) {
  if (!reports.length) return '';

  const reportItems = reports
    .map((report, index) => {
      const content =
        withoutLeadingHeading(report.sanitizedHtml) ||
        `<p style="color:#6b7280;">El informe ${escapeHtml(report.filename)} no contiene contenido legible tras el saneado.</p>`;

      return `
        <section style="margin:24px auto;padding:0;max-width:760px;background:#ffffff;">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111827;font-weight:700;">Informe de actualización — ${escapeHtml(
            report.site?.name || `Sitio ${index + 1}`
          )}</h1>
          <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827;">
            ${content}
          </div>
        </section>
      `;
    })
    .join('');

  return `
    <div style="max-width:760px;margin:20px auto 0;">
      ${reportItems}
    </div>
  `;
}
