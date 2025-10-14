import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { to, subject, html, attachments = [] } = await req.json();

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

    const nodemailerAttachments = (attachments as any[])
      .map((a) => {
        if (a?.contentBase64) {
          return {
            filename: a.filename || "adjunto.bin",
            content: Buffer.from(a.contentBase64, "base64"),
            contentType: a.contentType || "application/octet-stream",
          };
        }
        if (a?.url) {
          return { filename: a.filename || undefined, path: a.url };
        }
        return null;
      })
      .filter(Boolean) as any[];

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM!,
      to: recipients,
      subject: subject || "Informe DEMO",
      html: html || "<p>Informe DEMO adjunto.</p>",
      attachments: nodemailerAttachments,
    });

    return NextResponse.json({ ok: true, id: info.messageId });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
