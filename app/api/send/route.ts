import { Buffer } from 'node:buffer';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type SingleSendBody = {
  site: { name: string; url: string; email?: string | null };
  reportHtml: string | null; // data URL o null
  reportFileName: string;
  invoice?: { fileName: string; base64: string } | null;
  subject: string;
};

type GroupSendBody = {
  email: string;
  period?: string;
  sites: Array<{ name: string; url: string }>;
  reports: Array<{ fileName: string; dataUrl: string }>;
  invoice?: { fileName: string; base64: string } | null;
  subject: string;
  errors?: Array<{ site: { name: string; url: string }; error: string }>;
};

function isGroup(body: any): body is GroupSendBody {
  return body && Array.isArray(body.sites) && Array.isArray(body.reports) && typeof body.email === 'string';
}

function firstEnv(...keys: string[]) {
  for (const k of keys) {
    const v = process.env[k];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return undefined;
}

function parseBool(v: unknown, defaultValue?: boolean) {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '') return defaultValue ?? false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(s);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SingleSendBody | GroupSendBody;

    const to = isGroup(body)
      ? body.email.trim()
      : ((body.site.email && body.site.email.trim()) || process.env.EMAIL_TO_DEFAULT);

    if (!to) {
      return NextResponse.json(
        { ok: false, error: 'Email destino vacío (ni por sitio ni global)' },
        { status: 400 }
      );
    }

    // Compat: accept EMAIL_FROM (legacy), SMTP_FROM, MAIL_FROM. Fallback to the authenticated user.
    const smtpUser = firstEnv('SMTP_USER', 'MAIL_USER');
    const from =
      firstEnv('EMAIL_FROM', 'SMTP_FROM', 'MAIL_FROM') ||
      (smtpUser ? `Actualizador WP <${smtpUser}>` : 'Devestial <noreply@devestial.com>');

    // Construimos adjuntos
    const attachments: any[] = [];

    if (isGroup(body)) {
      for (const r of body.reports || []) {
        const base64 = String(r.dataUrl || '').split(',')[1] || '';
        if (!base64) continue;
        attachments.push({
          filename: r.fileName || 'informe.html',
          content: Buffer.from(base64, 'base64'),
          contentType: 'text/html; charset=utf-8',
        });
      }
    } else {
      if (body.reportHtml) {
        const base64 = body.reportHtml.split(',')[1] || '';
        attachments.push({
          filename: body.reportFileName || 'informe.html',
          content: Buffer.from(base64, 'base64'),
          contentType: 'text/html; charset=utf-8',
        });
      }
    }

    const invoice = (body as any).invoice;
    if (invoice?.base64) {
      attachments.push({
        filename: invoice.fileName || 'factura.pdf',
        content: Buffer.from(invoice.base64, 'base64'),
        contentType: 'application/pdf',
      });
    }

    const hasInvoice = Boolean(invoice?.base64);

    const htmlBody = isGroup(body)
      ? `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;">
        <p>Hola,</p>
        <p>Adjuntamos los <strong>informes de actualización</strong> de tus sitios${
          body.period ? ` (<b>${body.period}</b>)` : ''
        }${hasInvoice ? ' y la <strong>factura</strong>.' : '.'}</p>
        <p><b>Sitios incluidos:</b></p>
        <ul>
          ${body.sites
            .map(
              (s) =>
                `<li><b>${s.name}</b> — <a href="${s.url}" target="_blank" rel="noreferrer">${s.url}</a></li>`
            )
            .join('')}
        </ul>
        ${
          (body.errors || []).length
            ? `<p style="color:#b91c1c"><b>Nota:</b> hubo errores en algunos sitios y no se adjuntó su informe:</p>
               <ul style="color:#b91c1c">
                 ${(body.errors || [])
                   .map((e) => `<li><b>${e.site.name}</b> — ${e.site.url} — ${e.error}</li>`)
                   .join('')}
               </ul>`
            : ''
        }
        <p>Gracias,<br/>Devestial</p>
      </div>
    `
      : `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;">
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

      const smtpHost = firstEnv('SMTP_HOST', 'MAIL_HOST');
      const smtpPort = Number(firstEnv('SMTP_PORT', 'MAIL_PORT') || 587);
      const smtpSecure = parseBool(firstEnv('SMTP_SECURE', 'MAIL_SECURE'), smtpPort === 465);
      const smtpPass = firstEnv('SMTP_PASS', 'MAIL_PASS');

      const missing: string[] = [];
      if (!smtpHost) missing.push('SMTP_HOST (or MAIL_HOST)');
      if (!smtpUser) missing.push('SMTP_USER (or MAIL_USER)');
      if (!smtpPass) missing.push('SMTP_PASS (or MAIL_PASS)');
      if (missing.length) {
        throw new Error(`SMTP env missing: ${missing.join(', ')}`);
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
        connectionTimeout: 15000,
      });

      await transporter.verify(); // validación temprana

      await transporter.sendMail({
        from,
        to,
        subject: (body as any).subject || 'Actualización',
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
          subject: (body as any).subject,
          html: htmlBody,
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content: a.content.toString('base64'),
          })),
        }),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        const t = data?.message || data?.error || JSON.stringify(data);
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
