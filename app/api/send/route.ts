// app/api/send/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Att = { filename: string; contentB64: string; contentType?: string };

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const {
    to,
    subject = "Informe Actualitzador WP",
    html = "<p>Adjunto informe.</p>",
    attachments = [] as Att[],
  } = body;

  const from = process.env.EMAIL_FROM!;
  const toFinal = to || process.env.EMAIL_TO_DEFAULT;
  if (!from || !toFinal) {
    return NextResponse.json(
      { error: "EMAIL_FROM / EMAIL_TO_DEFAULT no configurados" },
      { status: 500 }
    );
  }

  // --- SMTP primero (si hay variables) ---
  if (process.env.SMTP_HOST) {
    try {
      const port = Number(process.env.SMTP_PORT || 587);
      const secure =
        (process.env.SMTP_SECURE || "").trim() === "1" || port === 465;

      // Import dinámico para evitar error de tipos si faltan @types/nodemailer
      // @ts-ignore
      const nodemailer = (await import("nodemailer")).default as any;

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure, // true = TLS (465); false = STARTTLS (587)
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
        connectionTimeout: 15_000,
        socketTimeout: 25_000,
      });

      const info = await transporter.sendMail({
        from,
        to: toFinal,
        subject,
        html,
        attachments: (attachments as Att[]).map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.contentB64, "base64"),
          contentType: a.contentType || "application/octet-stream",
        })),
      });

      return NextResponse.json({ ok: true, id: info.messageId, via: "smtp" });
    } catch (e: any) {
      // Si SMTP falla y hay RESEND_API_KEY, continuamos al fallback.
      if (!process.env.RESEND_API_KEY) {
        return NextResponse.json(
          { error: String(e) || "SMTP error" },
          { status: 500 }
        );
      }
    }
  }

  // --- Fallback: Resend por API HTTP (si está configurado) ---
  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: toFinal,
        subject,
        html,
        attachments: (attachments as Att[]).map((a) => ({
          filename: a.filename,
          content: a.contentB64, // base64
          contentType: a.contentType || "application/octet-stream",
        })),
      }),
    });

    const json = await res.json();
    if (!res.ok) return NextResponse.json({ error: json }, { status: res.status });
    return NextResponse.json({ ok: true, id: json.id, via: "resend" });
  }

  return NextResponse.json(
    { error: "Ni SMTP ni RESEND configurados" },
    { status: 500 }
  );
}
