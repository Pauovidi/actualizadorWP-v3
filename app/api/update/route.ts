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
  if (!/^https?:\/\//i.test(t)) {
    // añade https:// si no hay esquema y quita www. inicial (la UI ya hace algo similar)
    t = "https://" + t.replace(/^www\./i, "");
  }
  return t.replace(/\/+$/, "");
}

function cleanToken(tok: string): string {
  return (tok || "").replace(/^Bearer\s+/i, "").trim();
}

export async function POST(req: Request) {
  try {
    // 1) Leer body (JSON o form-data)
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

    // 2) Aceptar ambos formatos: { siteUrl, token } o { sites: [...] }
    let sites: SiteInput[] = [];
    if (body?.siteUrl && body?.token) {
      sites = [{ url: String(body.siteUrl), token: String(body.token) }];
    } else if (Array.isArray(body?.sites)) {
      sites = body.sites as SiteInput[];
    }

    // Validación básica
    if (!sites.length) {
      return NextResponse.json(
        { ok: false, error: "Missing siteUrl/token" },
        { status: 400 }
      );
    }

    // 3) Procesar cada sitio con la MISMA lógica que el CLI Python:
    //    POST sin body, sin Content-Type ni Authorization, con X-MAINT-TOKEN
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
            "X-MAINT-TOKEN": token,
          },
        });

        const text = await upstream.text();
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          // WP podría devolver texto/HTML; lo guardamos en text
        }

        if (!upstream.ok) {
          results.push({
            name,
            url,
            status: "ERROR",
            errors: [
              `${upstream.status} ${upstream.statusText}`,
              typeof text === "string" ? text.slice(0, 500) : "Upstream error",
            ],
          });
          continue;
        }

        // Intentamos mapear respuesta del plugin a lo que consume la UI
        // Campos habituales: status, errors, reportUrl, message, report.{fileName, html/base64}
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

        // Si el plugin devuelve el HTML/base64 pero no URL, la UI ya sabe convertir a data:,
        // pero por comodidad si viene una base64 plana sin prefijo, la mantenemos tal cual en data.report
        // La UI que tienes ya contempla varias variantes en n.data.*
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

    // 4) Respuesta para la UI: { ok, results }
    const hasError = results.some((r) => r.status === "ERROR");
    return NextResponse.json(
      { ok: !hasError, results },
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
