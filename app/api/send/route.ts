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

function fromDataUrl(u: string): Buffer | null {
  try {
    if (!u.startsWith("data:")) return null;
    const match = u.match(/^data:([^,]*),(.*)$/);
    if (!match) return null;
    const [, meta, data] = match;
    if (!data) return null;
    const isB64 = /;base64/i.test(meta || "");
    const payload = decodeURIComponent(data);
    return isB64 ? Buffer.from(payload, "base64") : Buffer.from(payload, "utf8");
  } catch {
    return null;
  }
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
    };
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      to,
      subject,
      html,
      attachments = [],
      reportUrl = null,
    } = body;

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

    const reportHtmlInline = typeof body?.reportHtml === "string" ? body.reportHtml : null;
    const reportFileName =
      typeof body?.reportFileName === "string" && body.reportFileName
        ? body.reportFileName
        : undefined;

    const resolved =
      typeof reportUrl === "string" && reportUrl.startsWith("data:")
        ? null
        : toAbs(reportUrl, req);

    let reportBuffer: Buffer | null = null;
    if (typeof reportUrl === "string" && reportUrl.startsWith("data:")) {
      reportBuffer = fromDataUrl(reportUrl) || null;
    } else if (resolved) {
      try {
        const response = await fetch(resolved, { cache: "no-store" });
        if (response.ok) {
          reportBuffer = Buffer.from(await response.arrayBuffer());
        }
      } catch {
        reportBuffer = null;
      }
    }

    if (!reportBuffer && reportHtmlInline) {
      reportBuffer = Buffer.from(reportHtmlInline, "utf8");
    }

    const nmAttachments: any[] = [];
    if (reportBuffer) {
      nmAttachments.push({
        filename: reportFileName || "informe.html",
        content: reportBuffer,
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

    const logoCid = await getLogoCidAttachment(req);
    if (logoCid) nmAttachments.push(logoCid);

    const intro =
      html ||
      'Hola. <br>Adjunto el informe de actualización de tu web, así como la fca. correspondiente a este mes. <br>Un saludo.';

    const htmlBody =
      intro +
      (resolved
        ? `<p><a href="${resolved}">Abrir informe en el navegador</a></p>`
        : "") +
      `<div style="margin-top:12px">
     <img src="cid:devestial-logo" alt="Devestial" style="height:40px;display:block;opacity:.95">
   </div>`;

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
