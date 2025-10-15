import { NextResponse } from "next/server";

import { isDemo } from "@/lib/env";

type Site = {
  name: string;
  url: string;
  token?: string;
  email?: string;
};

export async function POST(req: Request) {
  try {
    const { sites = [] } = await req.json();

    if (isDemo) {
      const results = (sites as Site[]).map((site) => ({
        site: site.name || "Sitio",
        status: "ok_with_notes",
        errors: 0,
        reportUrl: "/demo/sample-report.html",
        invoiceUrl: null,
        message: "DEMO: generado informe ficticio",
        lastSentAt: null,
      }));

      return NextResponse.json(
        { ok: true, mode: "demo", results },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { ok: false, error: "Real mode not implemented" },
      { status: 500 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
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
