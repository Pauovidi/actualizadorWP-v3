import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  createCorrelationId,
  createEmailTransport,
  extractEmail,
  getEmailConfig,
  hashForLog,
  htmlToText,
  normalizeRecipients,
} from '@/lib/email';

export const runtime = 'nodejs';

const MAX_TEST_RECIPIENTS = 4;
const TEST_SUBJECT = 'Prueba entregabilidad Actualizador WP';

function isEnabled() {
  return (
    process.env.ENABLE_EMAIL_TEST_PANEL === 'true' &&
    process.env.VERCEL_ENV !== 'production' &&
    typeof process.env.EMAIL_TEST_TOKEN === 'string' &&
    process.env.EMAIL_TEST_TOKEN.length >= 16
  );
}

function hasValidToken(req: Request) {
  const expected = process.env.EMAIL_TEST_TOKEN || '';
  const received = req.headers.get('x-email-test-token') || '';
  if (!expected || !received) return false;

  const encoder = new TextEncoder();
  const expectedBuffer = encoder.encode(expected);
  const receivedBuffer = encoder.encode(received);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function testHtml(correlationId: string) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;">
      <p>Este es un email de prueba del sistema <strong>Actualizador WP</strong>.</p>
      <p>No requiere acción. Se usa únicamente para validar entregabilidad en un preview controlado.</p>
      <p><small>Correlation ID: ${correlationId}</small></p>
    </div>
  `;
}

export async function GET() {
  if (!isEnabled()) {
    return NextResponse.json({ ok: false, enabled: false }, { status: 404 });
  }

    return NextResponse.json({
      ok: true,
      enabled: true,
      requiresToken: true,
      maxRecipients: MAX_TEST_RECIPIENTS,
      subject: TEST_SUBJECT,
    });
}

export async function POST(req: Request) {
  if (!isEnabled()) {
    return NextResponse.json({ ok: false, error: 'Email test panel is disabled' }, { status: 403 });
  }

  const requestCorrelationId = createCorrelationId(req.headers.get('x-correlation-id'));
  if (!hasValidToken(req)) {
    console.warn('email_test_error', {
      correlationId: requestCorrelationId,
      reason: 'invalid_token',
    });
    return NextResponse.json(
      { ok: false, error: 'Email test token is invalid', correlationId: requestCorrelationId },
      { status: 403 }
    );
  }

  try {
    const body = await req.json().catch(() => null);
    const recipients = normalizeRecipients((body as any)?.recipients)
      .map((email) => email.toLowerCase())
      .filter((email, index, list) => list.indexOf(email) === index);

    if (!recipients.length) {
      return NextResponse.json(
        { ok: false, error: 'At least one test recipient is required', correlationId: requestCorrelationId },
        { status: 400 }
      );
    }

    if (recipients.length > MAX_TEST_RECIPIENTS) {
      return NextResponse.json(
        { ok: false, error: `Maximum ${MAX_TEST_RECIPIENTS} recipients`, correlationId: requestCorrelationId },
        { status: 400 }
      );
    }

    const invalid = recipients.filter((email) => !isValidEmail(email));
    if (invalid.length) {
      return NextResponse.json(
        { ok: false, error: 'Invalid test recipient email', invalid, correlationId: requestCorrelationId },
        { status: 400 }
      );
    }

    const emailConfig = getEmailConfig();
    const transporter = createEmailTransport(emailConfig);
    const results = [];

    for (const recipient of recipients) {
      const correlationId = createCorrelationId(`${requestCorrelationId}:${hashForLog(recipient)}`);
      const html = testHtml(correlationId);
      const text = htmlToText(html);
      const startedAt = Date.now();

      console.info('email_test_attempt', {
        correlationId,
        recipientHash: hashForLog(recipient),
        provider: 'smtp',
        host: emailConfig.host,
        port: emailConfig.port,
        secure: emailConfig.secure,
        fromDomain: extractEmail(emailConfig.from).split('@').pop(),
      });

      try {
        const info = await transporter.sendMail({
          from: emailConfig.from,
          replyTo: emailConfig.replyTo,
          envelope: {
            from: emailConfig.envelopeFrom,
            to: [recipient],
          },
          to: recipient,
          subject: TEST_SUBJECT,
          html,
          text,
          headers: {
            'X-ActualizadorWP-Correlation-ID': correlationId,
            'X-ActualizadorWP-Test': 'deliverability-preview',
            'X-Entity-Ref-ID': correlationId,
          },
        });

        console.info('email_test_success', {
          correlationId,
          messageId: info.messageId,
          accepted: info.accepted?.length || 0,
          rejected: info.rejected?.length || 0,
          response: info.response,
          durationMs: Date.now() - startedAt,
        });

        results.push({
          recipient,
          ok: true,
          correlationId,
          id: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
        });
      } catch (err: any) {
        console.error('email_test_error', {
          correlationId,
          recipientHash: hashForLog(recipient),
          errorName: err?.name,
          errorCode: err?.code,
          message: 'Test email could not be sent',
          durationMs: Date.now() - startedAt,
        });

        results.push({
          recipient,
          ok: false,
          correlationId,
          error: 'Test email could not be sent',
        });
      }
    }

    return NextResponse.json({
      ok: results.every((result) => result.ok),
      correlationId: requestCorrelationId,
      subject: TEST_SUBJECT,
      results,
    });
  } catch (err: any) {
    console.error('email_test_error', {
      correlationId: requestCorrelationId,
      errorName: err?.name,
      errorCode: err?.code,
      message: 'Email test failed',
    });

    return NextResponse.json(
      { ok: false, error: 'Email test failed', correlationId: requestCorrelationId },
      { status: 500 }
    );
  }
}
