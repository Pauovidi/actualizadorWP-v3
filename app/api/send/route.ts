import { NextResponse } from "next/server";
import {
  EmailConfigError,
  createCorrelationId,
  createEmailTransport,
  extractEmail,
  getEmailConfig,
  hashForLog,
  htmlToText,
  normalizeRecipients,
} from "@/lib/email";

export const runtime = "nodejs";

const MAX_REPORT_HTML_BYTES = 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS = 3;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const recentSends = new Map<string, { at: number; correlationId: string }>();

function getBaseUrl(req: Request) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const origin = req.headers.get("origin");
  if (origin) return origin;
  return "";
}

async function getLogoCidAttachment(req: Request) {
  try {
    const base = getBaseUrl(req);
    if (!base) return null;
    const src = new URL("/devestial_logo.png", base).toString();
    const r = await fetch(src);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "image/png";
    return {
      filename: "devestial_logo.png",
      content: buf,
      contentType: ct,
      cid: "devestial-logo",
    } as const;
  } catch {
    return null;
  }
}

function toAbs(reportUrl: string | null, req: Request) {
  try {
    if (!reportUrl) return null;
    const base = getBaseUrl(req);
    const url = new URL(reportUrl, base || undefined);
    const allowedBase = base ? new URL(base) : null;
    if (allowedBase && url.origin !== allowedBase.origin) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function pruneRecentSends(now = Date.now()) {
  for (const [key, value] of recentSends) {
    if (now - value.at > IDEMPOTENCY_TTL_MS) recentSends.delete(key);
  }
}

function makeTextBody(htmlBody: string, reportHtml: string | null) {
  const parts = [htmlToText(htmlBody)];
  if (reportHtml) parts.push("Se adjunta el informe de actualizacion en formato HTML.");
  return parts.filter(Boolean).join("\n\n");
}

function publicError(error: unknown) {
  if (error instanceof EmailConfigError) return "Email service is not configured";
  return "Email could not be sent";
}

export async function POST(req: Request) {
  const correlationId = createCorrelationId(req.headers.get("x-correlation-id"));
  const startedAt = Date.now();

  try {
    const {
      to,
      subject,
      html,
      attachments = [],
      reportUrl = null,
      idempotencyKey = null,
    } = await req.json();

    const recipientsList = normalizeRecipients(to);
    const recipients = recipientsList.join(", ");

    if (!recipients) {
      return NextResponse.json(
        { ok: false, error: 'Missing "to" email', correlationId },
        { status: 400 }
      );
    }

    pruneRecentSends();
    const dedupeKey = hashForLog({
      idempotencyKey,
      recipientsList,
      subject: subject || "Informe",
      reportUrl,
      attachments: Array.isArray(attachments)
        ? attachments.map((attachment: any) => ({
            filename: attachment?.filename,
            contentHash: attachment?.contentBase64
              ? hashForLog(attachment.contentBase64)
              : null,
          }))
        : [],
    });

    const previous = recentSends.get(dedupeKey);
    if (previous && Date.now() - previous.at <= IDEMPOTENCY_TTL_MS) {
      console.warn("email_send_duplicate_blocked", {
        correlationId,
        previousCorrelationId: previous.correlationId,
        recipientsHash: hashForLog(recipientsList),
        dedupeKey,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "Duplicate email blocked",
          correlationId,
          duplicateOf: previous.correlationId,
        },
        { status: 409 }
      );
    }

    const emailConfig = getEmailConfig();
    const transporter = createEmailTransport(emailConfig);

    // === Preparar adjuntos ===
    const nmAttachments: any[] = [];
    const inputAttachments = Array.isArray(attachments) ? attachments : [];
    if (inputAttachments.length > MAX_ATTACHMENTS) {
      return NextResponse.json(
        { ok: false, error: "Too many attachments", correlationId },
        { status: 400 }
      );
    }

    // 1) Informe HTML desde data URL o desde URL absoluta/relativa
    let reportHtml: string | null = null;
    if (typeof reportUrl === "string" && reportUrl.length) {
      if (reportUrl.startsWith("data:text/html;base64,")) {
        try {
          const base64 = reportUrl.split(",")[1] || "";
          reportHtml = Buffer.from(base64, "base64").toString("utf8");
        } catch {
          reportHtml = null;
        }
      } else {
        const abs = toAbs(reportUrl, req);
        if (abs) {
          try {
            const response = await fetch(abs, { cache: "no-store" });
            reportHtml = response.ok ? await response.text() : null;
          } catch {
            reportHtml = null;
          }
        }
      }
    }
    if (reportHtml) {
      if (Buffer.byteLength(reportHtml, "utf8") > MAX_REPORT_HTML_BYTES) {
        return NextResponse.json(
          { ok: false, error: "Report is too large", correlationId },
          { status: 400 }
        );
      }
      nmAttachments.push({
        filename: "informe.html",
        content: Buffer.from(reportHtml, "utf8"),
        contentType: "text/html; charset=utf-8",
      });
    }

    // 2) Adjuntos extra (p.ej. factura PDF)
    for (const attachment of inputAttachments as any[]) {
      if (attachment?.contentBase64) {
        const content = Buffer.from(attachment.contentBase64, "base64");
        if (content.length > MAX_ATTACHMENT_BYTES) {
          return NextResponse.json(
            { ok: false, error: "Attachment is too large", correlationId },
            { status: 400 }
          );
        }
        nmAttachments.push({
          filename: attachment.filename || "adjunto.bin",
          content,
          contentType: attachment.contentType || "application/octet-stream",
        });
      } else if (attachment?.url) {
        return NextResponse.json(
          { ok: false, error: "Remote attachments are not allowed", correlationId },
          { status: 400 }
        );
      }
    }

    // 3) Logo inline (si está disponible)
    const logoCid = await getLogoCidAttachment(req);
    if (logoCid) nmAttachments.push(logoCid);

    // === Cuerpo del email (sin enlace “Abrir informe en el navegador”) ===
    const intro =
      html ||
      "Hola. <br>Adjunto el informe de actualización de tu web, así como la fca. correspondiente a este mes. <br>Un saludo.";

    const htmlBody =
      intro +
      `<div style="margin-top:12px">
         <img src="cid:devestial-logo" alt="Devestial" style="height:40px;display:block;opacity:.95">
       </div>`;
    const textBody = makeTextBody(htmlBody, reportHtml);

    console.info("email_send_attempt", {
      correlationId,
      recipientsHash: hashForLog(recipientsList),
      subjectHash: hashForLog(subject || "Informe"),
      attachmentCount: nmAttachments.length,
      hasReport: Boolean(reportHtml),
      provider: "smtp",
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      fromDomain: extractEmail(emailConfig.from).split("@").pop(),
    });

    const info = await transporter.sendMail({
      from: emailConfig.from,
      sender: emailConfig.envelopeFrom,
      replyTo: emailConfig.replyTo,
      envelope: {
        from: emailConfig.envelopeFrom,
        to: recipientsList,
      },
      to: recipients,
      subject: subject || "Informe",
      html: htmlBody,
      text: textBody,
      headers: {
        "X-ActualizadorWP-Correlation-ID": correlationId,
        "X-Entity-Ref-ID": correlationId,
      },
      attachments: nmAttachments,
    });

    recentSends.set(dedupeKey, { at: Date.now(), correlationId });

    console.info("email_send_success", {
      correlationId,
      messageId: info.messageId,
      accepted: info.accepted?.length || 0,
      rejected: info.rejected?.length || 0,
      response: info.response,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      id: info.messageId,
      correlationId,
      accepted: info.accepted,
      rejected: info.rejected,
    });
  } catch (e: any) {
    console.error("email_send_error", {
      correlationId,
      errorName: e?.name,
      errorCode: e?.code,
      message: e?.message || String(e),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { ok: false, error: publicError(e), correlationId },
      { status: 500 }
    );
  }
}
