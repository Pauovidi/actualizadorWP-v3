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

function mapStatus(s: any): "ok" | "ok_with_notes" | "warn" | "error" {
  const t = String(s || "").toUpperCase();
  if (t === "OK") return "ok";
  if (t === "WARN" || t === "WARNING" || t === "OK_WITH_NOTES") return "ok_with_notes";
  if (t === "ERROR" || t === "ERR") return "error";
  return "ok_with_notes";
}

async function updateReal(s: SiteIn): Promise<Result> {
  const siteName = s.name || s.url;
  if (!s.url) {
    return {
      site: siteName,
      status: "error",
      errors: 1,
      message: "Falta URL",
      reportUrl: null,
      lastSentAt: null,
      reportFileName: null,
    };
  }

  const endpoint = `${s.url.replace(/\/$/, "")}/wp-json/maint-agent/v1/update`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}),
      },
      body: JSON.stringify({ screenshot: false }),
    });
  } catch (e: any) {
    return {
      site: siteName,
      status: "error",
      errors: 1,
      message: `Conexión fallida: ${e?.message || e}`,
      reportUrl: null,
      lastSentAt: null,
      reportFileName: null,
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const note =
      res.status === 401
        ? "Token inválido o no enviado"
        : res.status === 404
        ? "Endpoint no encontrado (/wp-json/maint-agent/v1/update)"
        : `HTTP ${res.status} ${res.statusText}`;
    return {
      site: siteName,
      status: "error",
      errors: 1,
      message: `${note}${text ? ` — ${text.slice(0, 140)}` : ""}`,
      reportUrl: null,
      lastSentAt: null,
      reportFileName: null,
    };
  }

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // algunos plugins devuelven texto
  }

  const html = data?.htmlReport || data?.report || "";
  const filename = data?.reportFileName || `informe-${new Date().toISOString().slice(0, 10)}.html`;
  const reportUrl = html ? `data:text/html;base64,${Buffer.from(html, "utf8").toString("base64")}` : null;

  return {
    site: siteName,
    status: mapStatus(data?.status),
    errors: Array.isArray(data?.errors) ? data.errors.length : 0,
    message: data?.message || null,
    reportUrl,
    reportFileName: filename,
    lastSentAt: null,
  };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sites: SiteIn[] = Array.isArray(body?.sites) ? body.sites : [];
  const forceDemo = Boolean((body as any)?.demo);
  const demoMode = isDemo || forceDemo;

  if (demoMode) {
    const results = sites.map((s) => ({
      site: s?.name || "Sitio",
      status: "ok_with_notes" as const,
      errors: 0,
      message: "DEMO: generado informe ficticio",
      reportUrl: "/demo/sample-report.html",
      reportFileName: "informe-demo.html",
      lastSentAt: null,
    }));
    return NextResponse.json({ ok: true, mode: "demo", results }, { status: 200 });
  }

  const settled = await Promise.allSettled(sites.map(updateReal));
  const results = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          site: sites[i]?.name || sites[i]?.url || `Sitio ${i + 1}`,
          status: "error" as const,
          errors: 1,
          message: String(r.reason),
          reportUrl: null,
          reportFileName: null,
          lastSentAt: null,
        }
  );

  return NextResponse.json({ ok: true, mode: "real", results }, { status: 200 });
}
