import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = "nodejs";

function getBaseUrl(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

async function getLogoCidAttachment(req: Request) {
  const src = new URL("/devestial_logo.png", getBaseUrl(req)).toString();
  try {
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
    return new URL(reportUrl, base || undefined).toString();
  } catch {
    return null;
  }
}

const FROM = "pau@devestial.com";

export async function POST(req: Request) {
  try {
    const {
      to,
      subject,
      html,
      attachments = [],
      reportUrl = null,
    } = await req.json();

    let recipients: string | undefined;
    if (Array.isArray(to)) recipients = to.filter(Boolean).join(", ");
    else if (typeof to === "string") recipients = to.trim();

    if (!recipients) {
      return NextResponse.json(
        { ok: false, error: 'Missing "to" email' },
        { status: 400 }
      );
    }

    const secure =
      process.env.MAIL_SECURE === "1" || process.env.MAIL_PORT === "465";

    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST!,
      port: Number(process.env.MAIL_PORT || 587),
      secure,
      auth: { user: process.env.MAIL_USER!, pass: process.env.MAIL_PASS! },
    });

    // === Preparar adjuntos ===
    const nmAttachments: any[] = [];

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
      nmAttachments.push({
        filename: "informe.html",
        content: Buffer.from(reportHtml, "utf8"),
        contentType: "text/html; charset=utf-8",
      });
    }

    // 2) Adjuntos extra (p.ej. factura PDF)
    for (const attachment of attachments as any[]) {
      if (attachment?.contentBase64) {
        nmAttachments.push({
          filename: attachment.filename || "adjunto.bin",
          content: Buffer.from(attachment.contentBase64, "base64"),
          contentType: attachment.contentType || "application/octet-stream",
        });
      } else if (attachment?.url) {
        nmAttachments.push({
          filename: attachment.filename || undefined,
          path: attachment.url,
        });
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

    const info = await transporter.sendMail({
      from: FROM,         // <- remitente fijo
      sender: FROM,       // <- envelope/sender
      replyTo: FROM,      // <- respuestas a
      to: recipients,
      subject: subject || "Informe",
      html: htmlBody,
      attachments: nmAttachments,
    });

    return NextResponse.json({ ok: true, id: info.messageId });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

