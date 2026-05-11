import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
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
import { buildInlineReportsHtml, sanitizeReportHtml } from '@/lib/emailInlineReport';
import { renderReportClassicV1, rowsFromUpdated } from '@/lib/reportTemplate';

export const runtime = 'nodejs';

const MAX_TEST_RECIPIENTS = 4;
const TEST_SUBJECT = 'Prueba entregabilidad Actualizador WP';
const TEST_MODES = ['sin_adjuntos', 'informe_html_adjunto', 'pdf_ficticio_adjunto', 'informe_en_cuerpo'] as const;

type TestMode = (typeof TEST_MODES)[number];

type TestAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

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

function normalizeMode(value: unknown): TestMode {
  return TEST_MODES.includes(value as TestMode) ? (value as TestMode) : 'sin_adjuntos';
}

function buildRealisticReportHtml(correlationId: string) {
  const supportCorrelationId = correlationId.split('-')[0] || correlationId.slice(0, 8);
  const runStarted = new Date().toLocaleString('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Madrid',
  });
  const items = [
    {
      kind: 'core',
      name: 'WordPress Core',
      from: '6.7.1',
      to: '6.7.2',
      status: 'ok',
      note: 'Actualizacion menor aplicada correctamente.',
    },
    {
      kind: 'plugin',
      name: 'WooCommerce',
      from: '9.1.1',
      to: '9.2.0',
      status: 'ok',
      note: 'Plugin actualizado y sitio responde correctamente.',
    },
    {
      kind: 'plugin',
      name: 'Elementor',
      from: '3.25.0',
      to: '3.25.4',
      status: 'warn',
      note: 'Actualizado. Recomendado revisar cache visual de la home.',
    },
    {
      kind: 'plugin',
      name: 'Contact Form 7',
      from: '5.9.8',
      to: '5.9.9',
      status: 'ok',
      note: 'Formularios verificados sin incidencias detectadas.',
    },
    {
      kind: 'theme',
      name: 'Astra',
      from: '4.8.0',
      to: '4.8.1',
      status: 'ok',
      note: 'Tema actualizado correctamente.',
    },
  ];

  return renderReportClassicV1({
    heading: 'Informe de actualización WordPress',
    siteName: 'Sitio de prueba',
    siteUrl: 'https://cliente-ejemplo.com',
    runStarted,
    okCount: 4,
    warnCount: 1,
    errCount: 0,
    updatesRowsHtml: rowsFromUpdated(items),
    executiveSummaryHtml: `
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:14px;">
        <p><strong>Estado general OK.</strong> La actualizacion de WordPress, plugins y tema se completo correctamente.</p>
        <p>Se detecto una advertencia menor de revision visual tras actualizar Elementor. No bloquea el funcionamiento del sitio.</p>
        <p><strong>Fecha/hora:</strong> ${runStarted}</p>
      </div>
    `,
    issuesHeading: 'Errores y advertencias',
    errorsHtml: `
      <div class="errors-box">
        <strong>Errores y advertencias</strong>
        <ul>
          <li>Advertencia: revisar cache visual de la home tras actualizar Elementor.</li>
          <li>Sin errores bloqueantes durante la actualizacion.</li>
        </ul>
      </div>
    `,
    supportCorrelationId,
  });
}

function buildFakePdf(correlationId: string) {
  const text = `Documento ficticio Actualizador WP - ${correlationId}`;
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${obj}\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function baseEmailHtml(correlationId: string, mode: TestMode) {
  return `
    <div style="max-width:680px;margin:0 auto;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;color:#111827;">
      <p>Este es un email de prueba del sistema <strong>Actualizador WP</strong>.</p>
      <p>No requiere acción. Se usa únicamente para validar entregabilidad en un preview controlado.</p>
      <p><b>Modo:</b> ${mode}</p>
      <p><small>Correlation ID: ${correlationId}</small></p>
    </div>
  `;
}

function buildMessageParts(mode: TestMode, correlationId: string) {
  const attachments: TestAttachment[] = [];
  let html = baseEmailHtml(correlationId, mode);
  const reportHtml = buildRealisticReportHtml(correlationId);

  if (mode === 'informe_html_adjunto') {
    attachments.push({
      filename: 'informe-prueba-actualizador.html',
      content: Buffer.from(reportHtml, 'utf8'),
      contentType: 'text/html; charset=utf-8',
    });
  }

  if (mode === 'pdf_ficticio_adjunto') {
    attachments.push({
      filename: 'documento-prueba.pdf',
      content: buildFakePdf(correlationId),
      contentType: 'application/pdf',
    });
  }

  if (mode === 'informe_en_cuerpo') {
    html = `${baseEmailHtml(correlationId, mode)}
      ${buildInlineReportsHtml([
        {
          filename: 'informe-prueba-actualizador.html',
          sanitizedHtml: sanitizeReportHtml(reportHtml),
          site: { name: 'Sitio de prueba', url: 'https://cliente-ejemplo.com' },
          status: 'OK con una advertencia menor',
        },
      ])}
    `;
  }

  const attachmentBytes = attachments.reduce((sum, attachment) => sum + attachment.content.length, 0);
  const attachmentTypes = attachments.map((attachment) => attachment.contentType);

  return {
    html,
    text: htmlToText(html),
    attachments,
    attachmentCount: attachments.length,
    attachmentTypes,
    attachmentBytes,
  };
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
    modes: TEST_MODES,
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
    const mode = normalizeMode((body as any)?.mode);
    const recipients = normalizeRecipients((body as any)?.recipients)
      .map((email) => email.toLowerCase())
      .filter((email, index, list) => list.indexOf(email) === index);

    if (!recipients.length) {
      return NextResponse.json(
        { ok: false, error: 'At least one test recipient is required', mode, correlationId: requestCorrelationId },
        { status: 400 }
      );
    }

    if (recipients.length > MAX_TEST_RECIPIENTS) {
      return NextResponse.json(
        { ok: false, error: `Maximum ${MAX_TEST_RECIPIENTS} recipients`, mode, correlationId: requestCorrelationId },
        { status: 400 }
      );
    }

    const invalid = recipients.filter((email) => !isValidEmail(email));
    if (invalid.length) {
      return NextResponse.json(
        { ok: false, error: 'Invalid test recipient email', invalid, mode, correlationId: requestCorrelationId },
        { status: 400 }
      );
    }

    const emailConfig = getEmailConfig();
    const transporter = createEmailTransport(emailConfig);
    const results = [];

    for (const recipient of recipients) {
      const correlationId = createCorrelationId(`${requestCorrelationId}:${mode}:${hashForLog(recipient)}`);
      const message = buildMessageParts(mode, correlationId);
      const startedAt = Date.now();

      console.info('email_test_attempt', {
        correlationId,
        mode,
        recipientHash: hashForLog(recipient),
        provider: 'smtp',
        host: emailConfig.host,
        port: emailConfig.port,
        secure: emailConfig.secure,
        fromDomain: extractEmail(emailConfig.from).split('@').pop(),
        attachmentCount: message.attachmentCount,
        attachmentBytes: message.attachmentBytes,
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
          subject: `${TEST_SUBJECT} - ${mode}`,
          html: message.html,
          text: message.text,
          headers: {
            'X-ActualizadorWP-Correlation-ID': correlationId,
            'X-ActualizadorWP-Test': 'deliverability-preview',
            'X-ActualizadorWP-Test-Mode': mode,
            'X-Entity-Ref-ID': correlationId,
          },
          attachments: message.attachments,
        });

        console.info('email_test_success', {
          correlationId,
          mode,
          messageId: info.messageId,
          accepted: info.accepted?.length || 0,
          rejected: info.rejected?.length || 0,
          response: info.response,
          attachmentCount: message.attachmentCount,
          attachmentBytes: message.attachmentBytes,
          durationMs: Date.now() - startedAt,
        });

        results.push({
          recipient,
          ok: true,
          mode,
          correlationId,
          id: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
          attachmentCount: message.attachmentCount,
          attachmentTypes: message.attachmentTypes,
          attachmentBytes: message.attachmentBytes,
        });
      } catch (err: any) {
        console.error('email_test_error', {
          correlationId,
          mode,
          recipientHash: hashForLog(recipient),
          errorName: err?.name,
          errorCode: err?.code,
          message: 'Test email could not be sent',
          attachmentCount: message.attachmentCount,
          attachmentBytes: message.attachmentBytes,
          durationMs: Date.now() - startedAt,
        });

        results.push({
          recipient,
          ok: false,
          mode,
          correlationId,
          error: 'Test email could not be sent',
          attachmentCount: message.attachmentCount,
          attachmentTypes: message.attachmentTypes,
          attachmentBytes: message.attachmentBytes,
        });
      }
    }

    return NextResponse.json({
      ok: results.every((result) => result.ok),
      mode,
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
