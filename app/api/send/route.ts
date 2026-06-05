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
import { buildInlineReportsHtml, sanitizeReportHtml } from '@/lib/emailInlineReport';

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
type EmailErrorCategory =
  | 'smtp_auth'
  | 'smtp_connection'
  | 'smtp_rate_limit'
  | 'smtp_temporary'
  | 'config'
  | 'unknown';

type EmailReport = {
  filename: string;
  content: Buffer;
  sanitizedHtml: string;
  site?: { name: string; url: string };
  status: string;
};

type SmtpSendInfo = {
  messageId?: string;
  accepted?: unknown[];
  rejected?: unknown[];
  response?: string;
};

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 25;
const MAX_REPORT_HTML_BYTES = 1024 * 1024;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

const recentSends = new Map<string, { at: number; correlationId: string }>();

class EmailDeliveryError extends Error {
  causeError: unknown;
  alreadyLogged: boolean;

  constructor(causeError: unknown, alreadyLogged = false) {
    super('Email delivery failed');
    this.name = 'EmailDeliveryError';
    this.causeError = causeError;
    this.alreadyLogged = alreadyLogged;
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

function jsonError(status: number, error: string, correlationId: string, category?: EmailErrorCategory) {
  return NextResponse.json({ ok: false, error, correlationId, ...(category ? { category } : {}) }, { status });
}

function publicError(error: unknown) {
  if (error instanceof EmailConfigError) return 'Email service is not configured';
  if (error instanceof EmailDeliveryError) return 'No se pudo enviar el email';
  return 'No se pudo enviar el email';
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

function smtpValue(error: unknown, key: string) {
  if (!isRecord(error)) return undefined;
  const value = error[key];
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function sanitizeLogMessage(value: unknown) {
  return String(value || '')
    .replace(/(pass(word)?|pwd|token|secret|api[-_]?key|authorization)\s*[:=]\s*([^\s,;]+)/gi, '$1=[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

function classifyEmailError(error: unknown): EmailErrorCategory {
  if (error instanceof EmailConfigError) return 'config';

  const code = String(smtpValue(error, 'code') || '').toUpperCase();
  const command = String(smtpValue(error, 'command') || '').toUpperCase();
  const responseCodeRaw = smtpValue(error, 'responseCode');
  const responseCode =
    typeof responseCodeRaw === 'number'
      ? responseCodeRaw
      : typeof responseCodeRaw === 'string'
        ? Number(responseCodeRaw)
        : 0;
  const message = `${smtpValue(error, 'message') || ''} ${smtpValue(error, 'response') || ''}`.toLowerCase();

  if (
    code === 'EAUTH' ||
    command === 'AUTH' ||
    responseCode === 530 ||
    responseCode === 534 ||
    responseCode === 535 ||
    /auth|authentication|credentials|login|username|password/.test(message)
  ) {
    return 'smtp_auth';
  }

  if (
    code === 'ECONNECTION' ||
    code === 'ESOCKET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    /connect|connection|socket|timeout|timed out|dns|network|refused/.test(message)
  ) {
    return 'smtp_connection';
  }

  if (responseCode === 421 || responseCode === 450 || responseCode === 451 || responseCode === 452 || /rate|limit|throttle|quota|too many/.test(message)) {
    return 'smtp_rate_limit';
  }

  if (responseCode >= 400 && responseCode < 500) {
    return 'smtp_temporary';
  }

  return 'unknown';
}

function safeSmtpErrorValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number') {
    return sanitizeLogMessage(value);
  }
  return undefined;
}

function getErrorName(error: unknown) {
  if (error instanceof Error && error.name) return error.name;
  return safeSmtpErrorValue(smtpValue(error, 'name'));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return sanitizeLogMessage(error.message);
  return sanitizeLogMessage(smtpValue(error, 'message') || String(error || 'Unknown email error'));
}

function buildEmailErrorLog(params: {
  correlationId: string;
  category: EmailErrorCategory;
  error: unknown;
  durationMs: number;
  phase?: string;
}) {
  const error = params.error;
  const code = safeSmtpErrorValue(smtpValue(error, 'code'));
  const command = safeSmtpErrorValue(smtpValue(error, 'command'));
  const responseCode = smtpValue(error, 'responseCode');
  const response = safeSmtpErrorValue(smtpValue(error, 'response'));
  const message = getErrorMessage(error);
  const name = getErrorName(error);

  return {
    event: 'email_send_error',
    correlationId: params.correlationId,
    category: params.category,
    ...(params.phase ? { phase: params.phase } : {}),
    error: {
      name,
      code,
      command,
      responseCode,
      response,
      message,
    },
    errorName: name,
    errorCode: code,
    smtpCommand: command,
    smtpResponseCode: responseCode,
    smtpResponse: response,
    message,
    durationMs: params.durationMs,
  };
}

function logEmailSendError(params: {
  correlationId: string;
  category: EmailErrorCategory;
  error: unknown;
  durationMs: number;
  phase?: string;
}) {
  try {
    console.error('email_send_error', buildEmailErrorLog(params));
  } catch (logErr) {
    try {
      console.error('email_send_error_logger_failed', {
        event: 'email_send_error_logger_failed',
        correlationId: params.correlationId,
        category: params.category,
        loggerError: sanitizeLogMessage(logErr instanceof Error ? logErr.message : String(logErr)),
      });
    } catch {
      // Never let logging failures mask the original SMTP failure.
    }
  }
}

function getSmtpOperationTimeoutMs() {
  const parsed = Number(firstEnv('MAIL_SMTP_TIMEOUT_MS', 'SMTP_TIMEOUT_MS') || 8000);
  if (!Number.isFinite(parsed) || parsed <= 0) return 8000;
  return Math.min(Math.max(parsed, 3000), 25000);
}

function createSmtpTimeoutError(operation: string, timeoutMs: number) {
  const error = new Error(`SMTP ${operation} timed out after ${timeoutMs}ms`);
  Object.assign(error, {
    code: 'ETIMEDOUT',
    command: operation,
    responseCode: 421,
    response: `SMTP ${operation} timed out`,
  });
  return error;
}

async function withSmtpTimeout<T>(operation: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(createSmtpTimeoutError(operation, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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

    const smtpTimeoutMs = getSmtpOperationTimeoutMs();
    const transporter = createEmailTransport(emailConfig);
    try {
      await withSmtpTimeout('VERIFY', transporter.verify(), smtpTimeoutMs);
      const info = (await withSmtpTimeout('DATA', transporter.sendMail({
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
      }), smtpTimeoutMs)) as SmtpSendInfo;

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
      const smtpCategory = classifyEmailError(smtpErr);
      logEmailSendError({
        correlationId,
        category: smtpCategory,
        error: smtpErr,
        phase: 'smtp',
        durationMs: Date.now() - startedAt,
      });

      if (!resendApiKey) throw new EmailDeliveryError(smtpErr, true);

      console.warn('email_send_smtp_fallback', {
        correlationId,
        category: smtpCategory,
        errorName: smtpErr?.name,
        errorCode: smtpErr?.code,
        smtpResponseCode: smtpErr?.responseCode,
        smtpCommand: smtpErr?.command,
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
    } finally {
      try {
        transporter.close();
      } catch {
        // Best-effort cleanup after SMTP timeout or failure.
      }
    }
  } catch (err: any) {
    if (dedupeKey) recentSends.delete(dedupeKey);
    const status = err instanceof EmailConfigError || err instanceof EmailDeliveryError ? 500 : 400;
    const cause = err instanceof EmailDeliveryError ? err.causeError : err;
    const category = classifyEmailError(cause);
    const error =
      err instanceof EmailConfigError || err instanceof EmailDeliveryError
        ? publicError(err)
        : err?.message || 'Invalid email payload';
    if (!(err instanceof EmailDeliveryError && err.alreadyLogged)) {
      logEmailSendError({
        correlationId,
        category,
        error:
          err instanceof EmailConfigError
            ? new Error(`Email configuration missing: ${err.missing.join(', ')}`)
            : cause,
        phase: err instanceof EmailConfigError ? 'config' : 'request',
        durationMs: Date.now() - startedAt,
      });
    }
    return jsonError(status, error, correlationId, category);
  }
}
