// app/api/update/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    // Admitimos JSON o form-data; si no viene JSON, probamos form-data.
    let siteUrl = "";
    let token = "";

    // 1) Intento JSON
    try {
      const payload = await req.json(); // { siteUrl, token }
      siteUrl = (payload?.siteUrl ?? "").toString();
      token = (payload?.token ?? "").toString();
    } catch {
      // 2) Fallback a form-data
      try {
        const fd = await req.formData();
        siteUrl = ((fd.get("siteUrl") as string) ?? "").toString();
        token = ((fd.get("token") as string) ?? "").toString();
      } catch {
        // ignoramos: validaremos justo debajo
      }
    }

    // Saneamos token por si el usuario pegó "Bearer ...".
    token = token.replace(/^Bearer\s+/i, "").trim();
    siteUrl = siteUrl.trim();

    if (!siteUrl || !token) {
      return NextResponse.json(
        { ok: false, error: "Missing siteUrl/token" },
        { status: 400 }
      );
    }

    const endpoint =
      siteUrl.replace(/\/+$/, "") + "/wp-json/maint-agent/v1/update";

    // === MISMA LÓGICA QUE EL CLI PYTHON ===
    // - POST sin body
    // - Sin Content-Type
    // - Sin Authorization
    // - Con X-MAINT-TOKEN
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "User-Agent": "wp-maint-agent/ui",
        "X-MAINT-TOKEN": token,
      },
    });

    const text = await upstream.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      // Si WP devolviera HTML o texto plano, lo devolvemos tal cual.
    }

    if (!upstream.ok) {
      console.error(
        "WP update error",
        upstream.status,
        typeof text === "string" ? text.slice(0, 800) : text
      );
      return NextResponse.json(
        { ok: false, status: upstream.status, body: data ?? text },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, result: data ?? text });
  } catch (err: any) {
    console.error("API /api/update error", err?.message || err);
    return NextResponse.json(
      { ok: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
