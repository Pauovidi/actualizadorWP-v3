import { Buffer } from 'node:buffer';
import { NextResponse } from 'next/server';
import {
  EmailConfigError,
  createCorrelationId,
  createEmailTransport,
  extractEmail,
  firstEnv,
  getEmailConfig,
  hashForLog,
  htmlToText,
  normalizeRecipients,
} from '@/lib/email';

export const runtime = 'nodejs';

type SingleSendBody = {
  site: { name: string; url: string; email?: string | null };
  reportHtml: string | null;
  reportFileName: string;
  invoice?: { fileName: string; base64: string } | null;
  subject: string;
  idempotencyKey?: string | null;
  correlationId?: string | null;
};

type GroupSendBody = {
  email: string;
  period?: string;
  sites: Array<{ name: string; url: string }>;
  reports: Array<{ fileName: string; dataUrl: string }>;
  invoice?: { fileName: string; base64: string } | null;
  subject: string;
  errors?: Array<{ site: { name: string; url: string }; error: string }>;
  idempotencyKey?: string | null;
  correlationId?: string | null;
};

type Attachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 25;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

const recentSends = new Map<string, { at: number; correlationId: string }>();

class EmailDeliveryError extends Error {
  causeError: unknown;

  constructor(causeError: unknown) {
    super('Email delivery failed');
    this.name = 'EmailDeliveryError';
    this.causeError = causeError;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isGroup(body: unknown): body is GroupSendBody {
  return (
    isRecord(body) &&
    typeof body.email === 'string' &&
    Array.isArray(body.sites) &&
    Array.isArray(body.reports)
  );
}

function isSingle(body: unknown): body is SingleSendBody {
  return (
    isRecord(body) &&
    isRecord(body.site) &&
    typeof body.site.name === 'string' &&
    typeof body.site.url === 'string'
  );
}

function jsonError(status: number, error: string, correlationId: string) {
  return NextResponse.json({ ok: false, error, correlationId }, { status });
}

function publicError(error: unknown) {
  if (error instanceof EmailConfigError) return 'Email service is not configured';
  if (error instanceof EmailDeliveryError) return 'Email could not be sent';
  return 'Email could not be sent';
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseDataUrlBase64(value: unknown, expectedPrefix: string) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error('Remote attachments are not allowed');
  }
  if (!trimmed.startsWith(expectedPrefix)) {
    throw new Error('Invalid attachment data URL');
  }
  return trimmed.split(',')[1] || '';
}

function decodeBase64Attachment(base64: unknown, label: string) {
  if (typeof base64 !== 'string' || !base64.trim()) {
    throw new Error(`Missing ${label} content`);
  }
  const normalized = base64.trim().replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error(`Invalid ${label} base64`);
  }
  const content = Buffer.from(normalized, 'base64');
  if (!content.length) throw new Error(`Invalid ${label} content`);
  if (content.length > MAX_ATTACHMENT_BYTES) throw new Error(`${label} is too large`);
  return content;
}

function pushAttachment(attachments: Attachment[], attachment: Attachment) {
  if (attachments.length >= MAX_ATTACHMENTS) {
    throw new Error('Too many attachments');
  }
  const nextTotal =
    attachments.reduce((sum, item) => sum + item.content.length, 0) + attachment.content.length;
  if (nextTotal > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error('Attachments are too large');
  }
  attachments.push(attachment);
}

function buildAttachments(body: SingleSendBody | GroupSendBody) {
  const attachments: Attachment[] = [];

  if (isGroup(body)) {
    for (const report of body.reports || []) {
      if (!isRecord(report) || typeof report.dataUrl !== 'string') continue;
      const base64 = parseDataUrlBase64(report.dataUrl, 'data:text/html;base64,');
      const content = decodeBase64Attachment(base64, 'report');
      pushAttachment(attachments, {
        filename: typeof report.fileName === 'string' && report.fileName.trim() ? report.fileName.trim() : 'informe.html',
        content,
        contentType: 'text/html; charset=utf-8',
      });
    }
  } else if (body.reportHtml) {
    const base64 = parseDataUrlBase64(body.reportHtml, 'data:text/html;base64,');
    const content = decodeBase64Attachment(base64, 'report');
    pushAttachment(attachments, {
      filename: body.reportFileName || 'informe.html',
      content,
      contentType: 'text/html; charset=utf-8',
    });
  }

  const invoice = body.invoice;
  if (isRecord(invoice)) {
    const invoiceRecord = invoice as Record<string, unknown>;
    if (typeof invoiceRecord.url === 'string') throw new Error('Remote attachments are not allowed');
    const content = decodeBase64Attachment(invoice.base64, 'invoice');
    pushAttachment(attachments, {
      filename: typeof invoice.fileName === 'string' && invoice.fileName.trim() ? invoice.fileName.trim() : 'factura.pdf',
      content,
      contentType: 'application/pdf',
    });
  }

  return attachments;
}

function buildHtmlBody(body: SingleSendBody | GroupSendBody, hasInvoice: boolean) {
  if (isGroup(body)) {
    const siteItems = body.sites
      .map(
        (site) =>
          `<li><b>${escapeHtml(site.name)}</b> - <a href="${escapeHtml(site.url)}" target="_blank" rel="noreferrer">${escapeHtml(site.url)}</a></li>`
      )
      .join('');
    const errors = (body.errors || [])
      .map(
        (error) =>
          `<li><b>${escapeHtml(error.site?.name)}</b> - ${escapeHtml(error.site?.url)} - ${escapeHtml(error.error)}</li>`
      )
      .join('');

    return `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;">
        <p>Hola,</p>
        <p>Adjuntamos los <strong>informes de actualización</strong> de tus sitios${
          body.period ? ` (<b>${escapeHtml(body.period)}</b>)` : ''
        }${hasInvoice ? ' y la <strong>factura</strong>.' : '.'}</p>
        <p><b>Sitios incluidos:</b></p>
        <ul>${siteItems}</ul>
        ${
          errors
            ? `<p style="color:#b91c1c"><b>Nota:</b> hubo errores en algunos sitios y no se adjuntó su informe:</p>
               <ul style="color:#b91c1c">${errors}</ul>`
            : ''
        }
        <p>Gracias,<br/>Devestial</p>
      </div>
    `;
  }

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;">
      <p>Hola,</p>
      <p>Adjuntamos el <strong>informe de actualización</strong>${
        hasInvoice ? ' y la <strong>factura</strong>' : ''
      } del sitio <b>${escapeHtml(body.site.name)}</b>.</p>
      <ul>
        <li><b>Sitio:</b> ${escapeHtml(body.site.name)}</li>
        <li><b>URL:</b> ${escapeHtml(body.site.url)}</li>
      </ul>
      <p>Gracias,<br/>Devestial</p>
    </div>
  `;
}

function pruneRecentSends(now = Date.now()) {
  for (const [key, value] of recentSends) {
    if (now - value.at > IDEMPOTENCY_TTL_MS) recentSends.delete(key);
  }
}

function getDedupeKey(body: SingleSendBody | GroupSendBody, recipientsList: string[], attachments: Attachment[]) {
  const explicit = isRecord(body) && typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (explicit) return hashForLog({ explicit, recipientsList });

  return hashForLog({
    recipientsList,
    subject: body.subject || 'Actualización',
    period: isGroup(body) ? body.period || null : null,
    reports: attachments.map((attachment) => ({
      filename: attachment.filename,
      size: attachment.content.length,
      hash: hashForLog(attachment.content.toString('base64')),
    })),
  });
}

async function sendViaResend(params: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: Attachment[];
  correlationId: string;
}) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      headers: {
        'X-ActualizadorWP-Correlation-ID': params.correlationId,
        'X-Entity-Ref-ID': params.correlationId,
      },
      attachments: params.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content.toString('base64'),
        content_type: attachment.contentType,
      })),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Resend HTTP ${response.status}`);
  }
  return data;
}

export async function POST(req: Request) {
  let correlationId = createCorrelationId(req.headers.get('x-correlation-id'));
  const startedAt = Date.now();
  let dedupeKey = '';

  try {
    const rawBody = await req.json().catch(() => null);
    if (isRecord(rawBody) && rawBody.correlationId) {
      correlationId = createCorrelationId(rawBody.correlationId);
    }

    if (!isGroup(rawBody) && !isSingle(rawBody)) {
      console.warn('email_send_invalid_payload', { correlationId, bodyHash: hashForLog(rawBody) });
      return jsonError(400, 'Invalid email payload', correlationId);
    }

    const body = rawBody;
    const recipientsList = isGroup(body)
      ? normalizeRecipients(body.email)
      : normalizeRecipients(body.site.email || firstEnv('EMAIL_TO_DEFAULT'));
    const to = recipientsList.join(', ');

    if (!recipientsList.length) {
      return jsonError(400, 'Email destino vacío (ni por sitio ni global)', correlationId);
    }

    const attachments = buildAttachments(body);
    const subject = body.subject || 'Actualización';
    const html = buildHtmlBody(body, Boolean(body.invoice));
    const text = htmlToText(html);

    pruneRecentSends();
    dedupeKey = getDedupeKey(body, recipientsList, attachments);
    const previous = recentSends.get(dedupeKey);
    if (previous && Date.now() - previous.at <= IDEMPOTENCY_TTL_MS) {
      console.warn('email_send_duplicate_blocked', {
        correlationId,
        previousCorrelationId: previous.correlationId,
        recipientsHash: hashForLog(recipientsList),
        dedupeKey,
      });
      return NextResponse.json(
        { ok: false, error: 'Duplicate email blocked', correlationId, duplicateOf: previous.correlationId },
        { status: 409 }
      );
    }

    recentSends.set(dedupeKey, { at: Date.now(), correlationId });

    const resendApiKey = process.env.RESEND_API_KEY;
    let emailConfig;
    try {
      emailConfig = getEmailConfig();
    } catch (configErr) {
      if (!resendApiKey) throw configErr;

      const from =
        firstEnv('MAIL_FROM', 'SMTP_FROM', 'EMAIL_FROM') ||
        firstEnv('MAIL_USER', 'SMTP_USER') ||
        'Actualizador WP <noreply@devestial.com>';
      console.warn('email_send_smtp_fallback', {
        correlationId,
        provider: 'resend',
        reason: 'smtp_config_missing',
      });

      let data: any;
      try {
        data = await sendViaResend({
          apiKey: resendApiKey,
          from,
          to,
          subject,
          html,
          text,
          attachments,
          correlationId,
        });
      } catch (resendErr) {
        throw new EmailDeliveryError(resendErr);
      }

      console.info('email_send_success', {
        correlationId,
        provider: 'resend',
        id: data?.id,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ ok: true, via: 'resend', id: data?.id, correlationId });
    }

    const provider = 'smtp';
    console.info('email_send_attempt', {
      correlationId,
      provider,
      recipientsHash: hashForLog(recipientsList),
      subjectHash: hashForLog(subject),
      attachmentCount: attachments.length,
      attachmentBytes: attachments.reduce((sum, attachment) => sum + attachment.content.length, 0),
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      fromDomain: extractEmail(emailConfig.from).split('@').pop(),
    });

    try {
      const transporter = createEmailTransport(emailConfig);
      await transporter.verify();
      const info = await transporter.sendMail({
        from: emailConfig.from,
        replyTo: emailConfig.replyTo,
        envelope: {
          from: emailConfig.envelopeFrom,
          to: recipientsList,
        },
        to,
        subject,
        html,
        text,
        headers: {
          'X-ActualizadorWP-Correlation-ID': correlationId,
          'X-Entity-Ref-ID': correlationId,
        },
        attachments,
      });

      console.info('email_send_success', {
        correlationId,
        provider,
        messageId: info.messageId,
        accepted: info.accepted?.length || 0,
        rejected: info.rejected?.length || 0,
        response: info.response,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({
        ok: true,
        via: provider,
        id: info.messageId,
        correlationId,
        accepted: info.accepted,
        rejected: info.rejected,
      });
    } catch (smtpErr: any) {
      if (!resendApiKey) throw new EmailDeliveryError(smtpErr);

      console.warn('email_send_smtp_fallback', {
        correlationId,
        errorName: smtpErr?.name,
        errorCode: smtpErr?.code,
        provider: 'resend',
      });

      let data: any;
      try {
        data = await sendViaResend({
          apiKey: resendApiKey,
          from: emailConfig.from,
          to,
          subject,
          html,
          text,
          attachments,
          correlationId,
        });
      } catch (resendErr) {
        throw new EmailDeliveryError(resendErr);
      }

      console.info('email_send_success', {
        correlationId,
        provider: 'resend',
        id: data?.id,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ ok: true, via: 'resend', id: data?.id, correlationId });
    }
  } catch (err: any) {
    if (dedupeKey) recentSends.delete(dedupeKey);
    const status = err instanceof EmailConfigError || err instanceof EmailDeliveryError ? 500 : 400;
    const error =
      err instanceof EmailConfigError || err instanceof EmailDeliveryError
        ? publicError(err)
        : err?.message || 'Invalid email payload';
    const cause = err instanceof EmailDeliveryError ? err.causeError : err;
    console.error('email_send_error', {
      correlationId,
      errorName: cause instanceof Error ? cause.name : err?.name,
      errorCode: isRecord(cause) ? cause.code : err?.code,
      message:
        err instanceof EmailConfigError
          ? 'Email configuration missing'
          : err instanceof EmailDeliveryError
            ? 'Email delivery failed'
            : err?.message || String(err),
      durationMs: Date.now() - startedAt,
    });
    return jsonError(status, error, correlationId);
  }
}
