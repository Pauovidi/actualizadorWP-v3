import { NextResponse } from "next/server";

// Fuerza runtime Node (no Edge) para que lea process.env bien
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    NEXT_PUBLIC_MODE: process.env.NEXT_PUBLIC_MODE || "(unset)",
    NEXT_PUBLIC_DEMO: process.env.NEXT_PUBLIC_DEMO || "(unset)",
    MAIL_HOST: process.env.MAIL_HOST ? "(set)" : "(unset)",
    MAIL_PORT: process.env.MAIL_PORT || "(unset)",
    MAIL_USER: process.env.MAIL_USER ? "(set)" : "(unset)",
    MAIL_FROM: process.env.MAIL_FROM || "(unset)",
  });
}
