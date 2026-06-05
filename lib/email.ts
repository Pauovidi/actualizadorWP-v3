import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

export type EmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  replyTo?: string;
  envelopeFrom?: string;
};

export class EmailConfigError extends Error {
  missing: string[];

  constructor(missing: string[]) {
    super(`Missing email configuration: ${missing.join(', ')}`);
    this.name = 'EmailConfigError';
    this.missing = missing;
  }
}

export function firstEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function parseBool(value: unknown, defaultValue = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return defaultValue;
  return ['1', 'true', 'yes', 'y', 'on'].includes(text);
}

export function extractEmail(address: string) {
  const match = address.match(/<([^>]+)>/);
  return (match?.[1] || address || '').trim();
}

export function createCorrelationId(value?: unknown) {
  if (typeof value === 'string' && /^[a-zA-Z0-9._:-]{8,120}$/.test(value)) {
    return value;
  }
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

export function hashForLog(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

export function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeRecipients(to: unknown) {
  if (Array.isArray(to)) {
    return to
      .flatMap((value) => String(value || '').split(/[;,]/))
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (typeof to === 'string') {
    return to
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [];
}

export function getEmailConfig(): EmailConfig {
  const host = firstEnv('MAIL_HOST', 'SMTP_HOST');
  const user = firstEnv('MAIL_USER', 'SMTP_USER');
  const pass = firstEnv('MAIL_PASS', 'SMTP_PASS');
  const missing = [
    ['MAIL_HOST or SMTP_HOST', host],
    ['MAIL_USER or SMTP_USER', user],
    ['MAIL_PASS or SMTP_PASS', pass],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) throw new EmailConfigError(missing);

  const port = Number(firstEnv('MAIL_PORT', 'SMTP_PORT') || 587);
  const from =
    firstEnv('MAIL_FROM', 'SMTP_FROM', 'EMAIL_FROM') ||
    (user ? `Actualizador WP <${user}>` : 'Actualizador WP <noreply@devestial.com>');
  const replyTo = firstEnv('MAIL_REPLY_TO', 'SMTP_REPLY_TO', 'EMAIL_REPLY_TO') || undefined;
  const envelopeFrom = firstEnv('MAIL_ENVELOPE_FROM', 'SMTP_ENVELOPE_FROM', 'EMAIL_ENVELOPE_FROM') || undefined;

  return {
    host,
    port,
    secure: parseBool(firstEnv('MAIL_SECURE', 'SMTP_SECURE'), port === 465),
    user,
    pass,
    from,
    replyTo,
    envelopeFrom: envelopeFrom || extractEmail(from),
  };
}

export function createEmailTransport(config = getEmailConfig()) {
  const timeoutMs = Number(firstEnv('MAIL_SMTP_TIMEOUT_MS', 'SMTP_TIMEOUT_MS') || 8000);
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });
}
