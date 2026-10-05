function escape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function buildInvoiceOnlyHtml(names: string[], period?: string, message?: string | null) {
  const note = message?.trim() || '';
  if (note.length > 2000) throw new Error('El mensaje adicional es demasiado largo');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;">
    <p>Hola,</p>
    <p>Adjuntamos la <strong>factura PDF</strong>${period ? ` de <b>${escape(period)}</b>` : ''}${names.length ? ` correspondiente a <b>${names.map(escape).join(', ')}</b>` : ''}.</p>
    ${note ? `<p>${escape(note).replace(/\r?\n/g, '<br/>')}</p>` : ''}
    <p>Gracias,<br/>Devestial</p>
  </div>`;
}
