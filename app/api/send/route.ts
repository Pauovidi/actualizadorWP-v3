import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Att = { filename: string; contentB64: string; contentType?: string };

export async function POST(req: Request) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Missing RESEND_API_KEY" }, { status: 500 });
  }
  const body = await req.json().catch(() => ({}));
  const { to, subject = "Informe Actualitzador WP", html = "<p>Adjunto informe.</p>", attachments = [] as Att[] } = body;

  const from = process.env.EMAIL_FROM!;
  const toFinal = to || process.env.EMAIL_TO_DEFAULT;
  if (!from || !toFinal) {
    return NextResponse.json({ error: "EMAIL_FROM / EMAIL_TO_DEFAULT no configurados" }, { status: 500 });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: toFinal, subject, html,
      attachments: (attachments as Att[]).map(a => ({ filename: a.filename, content: a.contentB64, contentType: a.contentType || "application/octet-stream" }))
    }),
  });

  const json = await res.json();
  if (!res.ok) return NextResponse.json({ error: json }, { status: res.status });
  return NextResponse.json({ ok: true, id: json.id });
}
