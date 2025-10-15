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

function toAbs(reportUrl: string | null, req: Request) {
  try {
    if (!reportUrl) return null;
    const base = getBaseUrl(req);
    return new URL(reportUrl, base || undefined).toString();
  } catch {
    return null;
  }
}

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
      process.env.MAIL_SECURE === "1" ||
      process.env.MAIL_PORT === "465";

    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST!,
      port: Number(process.env.MAIL_PORT || 587),
      secure,
      auth: { user: process.env.MAIL_USER!, pass: process.env.MAIL_PASS! },
    });

    const abs = toAbs(reportUrl, req);
    let reportHtml: string | null = null;
    if (abs) {
      try {
        const response = await fetch(abs, { cache: "no-store" });
        reportHtml = response.ok ? await response.text() : null;
      } catch {
        reportHtml = null;
      }
    }

    const nmAttachments: any[] = [];
    if (reportHtml) {
      nmAttachments.push({
        filename: "informe.html",
        content: Buffer.from(reportHtml, "utf8"),
        contentType: "text/html; charset=utf-8",
      });
    }

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

    const intro =
      html ||
      'Hola. <br>Adjunto el informe de actualización de tu web, así como la fca. correspondiente a este mes. <br>Un saludo.';
    const htmlBody =
      intro +
      (abs
        ? `<p><a href="${abs}">Abrir informe en el navegador</a></p>`
        : "") +
      (reportHtml ? `<hr>${reportHtml}` : "");

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM!,
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
