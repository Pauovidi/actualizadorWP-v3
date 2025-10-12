import { NextResponse } from 'next/server';

type SendBody = {
  site: { name: string; url: string; email?: string | null };
  reportHtml: string | null;       // data URL o null
  reportFileName: string;          // para el informe
  invoice?: { fileName: string; base64: string } | null;
  subject: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SendBody;

    const to =
      (body.site.email && body.site.email.trim()) ||
      process.env.EMAIL_TO_DEFAULT;

    if (!to) {
      return NextResponse.json(
        { ok: false, error: 'Email destino vacío (ni por sitio ni global)' },
        { status: 400 }
      );
    }

    const from = process.env.EMAIL_FROM || 'Devestial <noreply@devestial.com>';

    // Construimos adjuntos
    const attachments: any[] = [];
    if (body.reportHtml) {
      // data:text/html;base64,xxxx
      const base64 = body.reportHtml.split(',')[1] || '';
      attachments.push({
        filename: body.reportFileName || 'informe.html',
        content: Buffer.from(base64, 'base64'),
        contentType: 'text/html; charset=utf-8',
      });
    }
    if (body.invoice?.base64) {
      attachments.push({
        filename: body.invoice.fileName || 'factura.pdf',
        content: Buffer.from(body.invoice.base64, 'base64'),
        contentType: 'application/pdf',
      });
    }

    const htmlBody = `
      <div style="font-family:Inter,system-ui,-apple-system,sans-serif">
        <p>Hola,</p>
        <p>Adjuntamos el <strong>informe de actualización</strong> y la <strong>factura</strong> del sitio <b>${body.site.name}</b>.</p>
        <ul>
          <li><b>Sitio:</b> ${body.site.name}</li>
          <li><b>URL:</b> ${body.site.url}</li>
        </ul>
        <p>Gracias,<br/>Devestial</p>
      </div>
    `;

    // 1) Intento con SMTP
    try {
      const { default: nodemailer } = await import('nodemailer');

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === '1',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.verify(); // validación temprana

      await transporter.sendMail({
        from,
        to,
        subject: body.subject,
        html: htmlBody,
        attachments,
      });

      return NextResponse.json({ ok: true, via: 'smtp' });
    } catch (smtpErr: any) {
      // 2) Fallback Resend si hay API key
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { ok: false, error: `SMTP error: ${smtpErr?.message || smtpErr}` },
          { status: 500 }
        );
      }

      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to,
          subject: body.subject,
          html: htmlBody,
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content: a.content.toString('base64'),
          })),
        }),
      });

      if (!resp.ok) {
        const t = await resp.text();
        return NextResponse.json(
          { ok: false, error: `Resend error: ${t}` },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, via: 'resend' });
    }
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
