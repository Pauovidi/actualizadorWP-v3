// app/api/update/route.ts
import { NextResponse } from "next/server";
import { isDemo } from "@/lib/env";

type SiteIn = { name?: string; url: string; token?: string; email?: string };
type Result = {
  site: string;
  status: "ok" | "ok_with_notes" | "warn" | "error";
  errors: number;
  message: string | null;
  reportUrl: string | null;
  reportFileName?: string | null;
  lastSentAt: string | null;
};

export const runtime = "nodejs";

// Mapeo simple (como el original)
function mapStatus(s: any): Result["status"] {
  const t = String(s || "").toUpperCase();
  if (t === "OK") return "ok";
  if (t === "WARN" || t === "WARNING" || t === "OK_WITH_NOTES") return "ok_with_notes";
  if (t === "ERROR" || t === "ERR" || t === "FAIL") return "error";
  return "ok_with_notes";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sites: SiteIn[] = Array.isArray(body?.sites) ? body.sites : [];
  const forceDemo = Boolean(body?.demo);
  const demoMode = isDemo || forceDemo;

  // --- DEMO ---
  if (demoMode) {
    const results: Result[] = sites.map((s) => ({
      site: s?.name || "Sitio",
      status: "ok_with_notes",
      errors: 0,
      message: "DEMO: generado informe ficticio",
      reportUrl: "/demo/sample-report.html",
      reportFileName: "informe-demo.html",
      lastSentAt: null,
    }));
    return NextResponse.json({ ok: true, mode: "demo", results }, { status: 200 });
  }

  // --- REAL (Bearer SIEMPRE; el token es el que emite tu plugin) ---
  const results: Result[] = await Promise.all(
    sites.map(async (s) => {
      const siteName = s?.name || s?.url || "Sitio";
      const baseUrl = (s?.url || "").trim().replace(/\/$/, "");
      const token = (s?.token || "").trim();

      if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
        return {
          site: siteName,
          status: "error",
          errors: 1,
          message: "URL inválida",
          reportUrl: null,
          reportFileName: null,
          lastSentAt: null,
        };
      }
      if (!token) {
        return {
          site: siteName,
          status: "error",
          errors: 1,
          message: "Token no enviado",
          reportUrl: null,
          reportFileName: null,
          lastSentAt: null,
        };
      }

      const endpoint = `${baseUrl}/wp-json/maint-agent/v1/update`;

      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          accept: "application/json",
          Authorization: `Bearer ${token}`, // <--- SIEMPRE Bearer (token del plugin)
        };

        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ screenshot: false }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          // Log útil en Vercel para diagnosticar rápido
          console.error("[/api/update] WP error", {
            site: siteName,
            endpoint,
            status: res.status,
            statusText: res.statusText,
            snippet: text?.slice(0, 300),
          });

          const note =
            res.status === 400
              ? "JSON inválido o esquema no esperado"
              : res.status === 401
              ? "Token inválido o no enviado"
              : res.status === 403
              ? "Acceso denegado"
              : res.status === 404
              ? "Endpoint no encontrado (/wp-json/maint-agent/v1/update)"
              : `HTTP ${res.status} ${res.statusText}`;

          return {
            site: siteName,
            status: "error",
            errors: 1,
            message: `${note}${text ? ` — ${text.slice(0, 160)}` : ""}`,
            reportUrl: null,
            reportFileName: null,
            lastSentAt: null,
          };
        }

        const data: any = await res.json().catch(() => ({}));

        // El agente puede devolver:
        //  - htmlReport: string (HTML completo inline)
        //  - reportUrl: URL absoluta http/https
        //  - status, errors (array o número), message, reportFileName
        let reportUrl: string | null = null;
        const fileName =
          data?.reportFileName || `informe-${new Date().toISOString().slice(0, 10)}.html`;

        if (typeof data?.reportUrl === "string" && /^https?:\/\//i.test(data.reportUrl)) {
          reportUrl = data.reportUrl;
        } else if (typeof data?.htmlReport === "string" && data.htmlReport.length) {
          // Convertimos a data URL para que “Ver informe” funcione y /api/send pueda adjuntarlo
          const b64 = Buffer.from(data.htmlReport, "utf8").toString("base64");
          reportUrl = `data:text/html;base64,${b64}`;
        }

        return {
          site: siteName,
          status: mapStatus(data?.status),
          errors: Array.isArray(data?.errors) ? data.errors.length : Number(data?.errors || 0),
          message: data?.message || null,
          reportUrl,
          reportFileName: fileName,
          lastSentAt: null,
        };
      } catch (e: any) {
        return {
          site: siteName,
          status: "error",
          errors: 1,
          message: String(e?.message || e),
          reportUrl: null,
          reportFileName: null,
          lastSentAt: null,
        };
      }
    })
  );

  return NextResponse.json({ ok: true, mode: "real", results }, { status: 200 });
}
