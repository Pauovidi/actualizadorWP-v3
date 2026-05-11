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
  reports: Array<{
    fileName: string;
    dataUrl: string;
    site?: { name: string; url: string };
    status?: string;
  }>;
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

type ReportDeliveryMode = 'inline' | 'attach' | 'both';

type EmailReport = {
  filename: string;
  content: Buffer;
  sanitizedHtml: string;
  site?: { name: string; url: string };
  status: string;
};

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 25;
const MAX_REPORT_HTML_BYTES = 1024 * 1024;
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

function getReportDeliveryMode(): ReportDeliveryMode {
  const raw = (process.env.EMAIL_REPORT_DELIVERY_MODE || 'inline').trim().toLowerCase();
  if (raw === 'attach' || raw === 'both') return raw;
  return 'inline';
}

function safeFilename(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().replace(/[\\/:*?"<>|]+/g, '-');
  return cleaned || fallback;
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

function decodeReportHtml(dataUrl: unknown) {
  const base64 = parseDataUrlBase64(dataUrl, 'data:text/html;base64,');
  const content = decodeBase64Attachment(base64, 'report');
  if (content.length > MAX_REPORT_HTML_BYTES) throw new Error('report is too large');
  return {
    content,
    html: content.toString('utf8'),
  };
}

function sanitizeReportHtml(html: string) {
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

function siteErrorStatus(body: GroupSendBody, site?: { name: string; url: string }) {
  if (!site) return 'Informe generado';
  const error = (body.errors || []).find(
    (item) => item.site?.url === site.url || item.site?.name === site.name
  );
  return error ? `Error: ${error.error}` : 'Informe generado';
}

function collectReports(body: SingleSendBody | GroupSendBody): EmailReport[] {
  const reports: EmailReport[] = [];

  if (isGroup(body)) {
    for (const [index, report] of (body.reports || []).entries()) {
      if (!isRecord(report) || typeof report.dataUrl !== 'string') continue;
      const decoded = decodeReportHtml(report.dataUrl);
      const site =
        isRecord(report.site) &&
        typeof report.site.name === 'string' &&
        typeof report.site.url === 'string'
          ? { name: report.site.name, url: report.site.url }
          : body.sites[index];
      reports.push({
        filename: safeFilename(report.fileName, 'informe.html'),
        content: decoded.content,
        sanitizedHtml: sanitizeReportHtml(decoded.html),
        site,
        status: typeof report.status === 'string' && report.status.trim() ? report.status.trim() : siteErrorStatus(body, site),
      });
    }
    return reports;
  }

  if (body.reportHtml) {
    const decoded = decodeReportHtml(body.reportHtml);
    reports.push({
      filename: safeFilename(body.reportFileName, 'informe.html'),
      content: decoded.content,
      sanitizedHtml: sanitizeReportHtml(decoded.html),
      site: body.site,
      status: 'Informe generado',
    });
  }

  return reports;
}

function buildAttachments(
  body: SingleSendBody | GroupSendBody,
  reportDeliveryMode: ReportDeliveryMode,
  reports: EmailReport[]
) {
  const attachments: Attachment[] = [];

  if (reportDeliveryMode === 'attach' || reportDeliveryMode === 'both') {
    for (const report of reports) {
      pushAttachment(attachments, {
        filename: report.filename,
        content: report.content,
        contentType: 'text/html; charset=utf-8',
      });
    }
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

function buildInlineReportsHtml(reports: EmailReport[]) {
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
    <div style="margin-top:20px;">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 12px;color:#111827;">Informes de actualización</h1>
      ${reportItems}
    </div>
  `;
}

function buildHtmlBody(
  body: SingleSendBody | GroupSendBody,
  hasInvoice: boolean,
  reportDeliveryMode: ReportDeliveryMode,
  reports: EmailReport[]
) {
  const inlineReports = reportDeliveryMode === 'inline' || reportDeliveryMode === 'both';
  const attachedReports = reportDeliveryMode === 'attach' || reportDeliveryMode === 'both';
  const reportsDescription = inlineReports
    ? 'incluimos en este email los <strong>informes de actualización</strong>'
    : 'adjuntamos los <strong>informes de actualización</strong>';

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
        <p>${reportsDescription} de tus sitios${
          body.period ? ` (<b>${escapeHtml(body.period)}</b>)` : ''
        }${hasInvoice ? ' y adjuntamos la <strong>factura PDF</strong>.' : '.'}</p>
        <p><b>Sitios incluidos:</b></p>
        <ul>${siteItems}</ul>
        ${
          errors
            ? `<p style="color:#b91c1c"><b>Nota:</b> hubo errores en algunos sitios y no se adjuntó su informe:</p>
               <ul style="color:#b91c1c">${errors}</ul>`
            : ''
        }
        ${
          attachedReports && !inlineReports
            ? '<p>Los informes HTML van adjuntos a este email.</p>'
            : ''
        }
        ${inlineReports ? buildInlineReportsHtml(reports) : ''}
        <p>Gracias,<br/>Devestial</p>
      </div>
    `;
  }

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;">
      <p>Hola,</p>
      <p>${inlineReports ? 'Incluimos en este email' : 'Adjuntamos'} el <strong>informe de actualización</strong>${
        hasInvoice ? ' y adjuntamos la <strong>factura PDF</strong>' : ''
      } del sitio <b>${escapeHtml(body.site.name)}</b>.</p>
      <ul>
        <li><b>Sitio:</b> ${escapeHtml(body.site.name)}</li>
        <li><b>URL:</b> ${escapeHtml(body.site.url)}</li>
      </ul>
      ${attachedReports && !inlineReports ? '<p>El informe HTML va adjunto a este email.</p>' : ''}
      ${inlineReports ? buildInlineReportsHtml(reports) : ''}
      <p>Gracias,<br/>Devestial</p>
    </div>
  `;
}

function pruneRecentSends(now = Date.now()) {
  for (const [key, value] of recentSends) {
    if (now - value.at > IDEMPOTENCY_TTL_MS) recentSends.delete(key);
  }
}

function getDedupeKey(
  body: SingleSendBody | GroupSendBody,
  recipientsList: string[],
  attachments: Attachment[],
  reports: EmailReport[],
  reportDeliveryMode: ReportDeliveryMode
) {
  const explicit = isRecord(body) && typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (explicit) return hashForLog({ explicit, recipientsList });

  return hashForLog({
    recipientsList,
    subject: body.subject || 'Actualización',
    period: isGroup(body) ? body.period || null : null,
    reportDeliveryMode,
    reports: reports.map((report) => ({
      filename: report.filename,
      size: report.content.length,
      hash: hashForLog(report.content.toString('base64')),
    })),
    attachments: attachments.map((attachment) => ({
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

    const reportDeliveryMode = getReportDeliveryMode();
    const reports = collectReports(body);
    const attachments = buildAttachments(body, reportDeliveryMode, reports);
    const subject = body.subject || 'Actualización';
    const html = buildHtmlBody(body, Boolean(body.invoice), reportDeliveryMode, reports);
    const text = htmlToText(html);

    pruneRecentSends();
    dedupeKey = getDedupeKey(body, recipientsList, attachments, reports, reportDeliveryMode);
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
        reportDeliveryMode,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ ok: true, via: 'resend', id: data?.id, correlationId, reportDeliveryMode });
    }

    const provider = 'smtp';
    console.info('email_send_attempt', {
      correlationId,
      provider,
      recipientsHash: hashForLog(recipientsList),
      subjectHash: hashForLog(subject),
      reportDeliveryMode,
      reportCount: reports.length,
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
        reportDeliveryMode,
        response: info.response,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({
        ok: true,
        via: provider,
        id: info.messageId,
        correlationId,
        reportDeliveryMode,
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
        reportDeliveryMode,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ ok: true, via: 'resend', id: data?.id, correlationId, reportDeliveryMode });
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
