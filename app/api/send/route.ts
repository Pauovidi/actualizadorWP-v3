import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

import { smtp } from "@/lib/env";

export async function POST(req: Request) {
  try {
    const { to, subject, html, attachments = [] } = await req.json();

    if (!smtp.host || !smtp.port || !smtp.auth.user || !smtp.auth.pass) {
      throw new Error(
        "Configura MAIL_HOST, MAIL_PORT, MAIL_USER y MAIL_PASS en Vercel."
      );
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: false,
      auth: smtp.auth,
    });

    const info = await transporter.sendMail({
      from: smtp.from,
      to,
      subject: subject || "Informe DEMO",
      html: html || "<p>Informe DEMO adjunto.</p>",
      attachments: attachments.map((attachment: any) => ({
        filename: attachment.filename,
        path: attachment.url,
      })),
    });

    return NextResponse.json({ ok: true, id: info.messageId });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message },
      { status: 500 }
    );
  }
}
