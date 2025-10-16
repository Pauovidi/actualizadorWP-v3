// app/api/update/route.ts
import { NextResponse } from "next/server";

type SiteInput = { name?: string; url: string; token: string; email?: string };
type SiteResult = {
  name?: string;
  url: string;
  status: "OK" | "WARN" | "ERROR" | string;
  errors: string[];
  message?: string;
  reportUrl?: string;
  reportFileName?: string;
};

function normalizeUrl(input: string): string {
  if (!input) return "";
  let t = input.trim();
  if (!/^https?:\/\//i.test(t)) t = "https://" + t.replace(/^www\./i, "");
  return t.replace(/\/+$/, "");
}

function cleanToken(tok: string): string {
  return (tok || "").replace(/^Bearer\s+/i, "").trim();
}

export async function POST(req: Request) {
  try {
    // --- 1) Body (JSON o form-data) ---
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      try {
        const fd = await req.formData();
        const siteUrl = (fd.get("siteUrl") as string) || "";
        const token = (fd.get("token") as string) || "";
        const sites: SiteInput[] = [];
        if (siteUrl && token) sites.push({ url: siteUrl, token });
        body = { sites };
      } catch {
        body = null;
      }
    }

    // --- 2) Aceptar ambos formatos: { siteUrl, token } o { sites: [...] } ---
    let sites: SiteInput[] = [];
    if (body?.siteUrl && body?.token) {
      sites = [{ url: String(body.siteUrl), token: String(body.token) }];
    } else if (Array.isArray(body?.sites)) {
      sites = body.sites as SiteInput[];
    }

    if (!sites.length) {
      // Mantengo 400 aquí porque sí es un error de input real
      return NextResponse.json(
        { ok: false, error: "Missing siteUrl/token" },
        { status: 400 }
      );
    }

    // --- 3) Procesar sitios con la MISMA lógica que el CLI Python ---
    const results: SiteResult[] = [];

    for (const s of sites) {
      const url = normalizeUrl(s.url);
      const token = cleanToken(s.token);
      const name = s.name;

      if (!url || !token) {
        results.push({
          name,
          url,
          status: "ERROR",
          errors: ["Missing siteUrl/token"],
        });
        continue;
      }

      const endpoint = `${url}/wp-json/maint-agent/v1/update`;

      try {
        const upstream = await fetch(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "User-Agent": "wp-maint-agent/ui",
            "X-MAINT-TOKEN": token, // <-- como tu Python
          },
        });

        const text = await upstream.text();
        let data: any = null;
        try { data = JSON.parse(text); } catch { /* puede ser HTML/texto */ }

        if (!upstream.ok) {
          results.push({
            name,
            url,
            status: "ERROR",
            errors: [
              `${upstream.status} ${upstream.statusText || ""}`.trim(),
              typeof text === "string" ? text.slice(0, 500) : "Upstream error",
            ],
          });
          continue;
        }

        const errors: string[] = [];
        if (Array.isArray(data?.errors)) {
          errors.push(...data.errors.map((x: any) => String(x)));
        } else if (data?.errors) {
          errors.push(String(data.errors));
        }

        const status: string =
          (data?.status && String(data.status)) ||
          (errors.length ? "WARN" : "OK");

        let reportUrl: string | undefined =
          typeof data?.reportUrl === "string" ? data.reportUrl : undefined;

        let reportFileName: string | undefined =
          (data?.reportFileName as string) ||
          (data?.report?.fileName as string) ||
          undefined;

        results.push({
          name,
          url,
          status: (status || "OK").toUpperCase(),
          errors,
          message: data?.message ? String(data.message) : undefined,
          reportUrl,
          reportFileName,
        });
      } catch (e: any) {
        results.push({
          name,
          url,
          status: "ERROR",
          errors: [String(e?.message || e || "Fetch failed")],
        });
      }
    }

    // --- 4) Siempre ok:true para que la UI NO corte el flujo y pinte la tabla ---
    const summary = {
      total: results.length,
      ok: results.filter(r => r.status === "OK").length,
      warn: results.filter(r => r.status === "WARN").length,
      error: results.filter(r => r.status === "ERROR").length,
    };

    return NextResponse.json(
      { ok: true, results, summary },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("API /api/update error", err?.message || err);
    return NextResponse.json(
      { ok: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
