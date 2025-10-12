import { NextResponse } from "next/server";
import { z } from "zod";
import { readFile } from "fs/promises";
import path from "path";
import type { SiteInput, ApiUpdateResponse, UpdateResponse } from "@/lib/types";
import { renderReportClassicV1, rowsFromUpdated, errorsBox } from "@/lib/reportTemplate";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  sites: z.array(z.object({
    name: z.string().min(1),
    url: z.string().url(),
    token: z.string().min(1),
    screenshotUrl: z.string().url().optional(),
    emailTo: z.string().email().optional(),
    invoiceName: z.string().optional(),
    invoiceType: z.string().optional(),
    invoiceB64: z.string().optional(),
  })).min(1)
});

async function getLogoDataUri(): Promise<string | undefined> {
  try {
    const p = path.join(process.cwd(), "public", "devestial_logo.png");
    const buf = await readFile(p);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch { return undefined; }
}

function pad2(n: number){ return n < 10 ? `0${n}` : String(n); }
function stamp(d: Date){
  return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Quita path/query/fragment, asegura base y sin barra final
function normalizeBase(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    u.pathname = ""; u.search = ""; u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch { return urlStr; }
}

// Alterna www. en el hostname
function toggleWww(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    u.hostname = u.hostname.startsWith("www.")
      ? u.hostname.slice(4)
      : `www.${u.hostname}`;
    return u.toString().replace(/\/$/, "");
  } catch { return urlStr; }
}

export async function POST(req: Request){
  const DEMO = process.env.DEMO_MODE === "1";
  const SCREENSHOT = process.env.SCREENSHOT_ENABLED !== "0";
  const logoDataUri = await getLogoDataUri();

  const json = await req.json().catch(()=> ({}));
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success){
    return NextResponse.json({ error: parsed.error.flatten(), sites: [] }, { status: 400 });
  }

  const sites: SiteInput[] = parsed.data.sites.map(s => ({ ...s, url: s.url.replace(/\/$/, "") }));

  const tasks = sites.map(async (site) => {
    const started = new Date();
    try{
      let data: any;
      if (DEMO){
        data = {
          status: "ok",
          updated: [
            { kind:"plugin", name:"classic-editor", from:"1.6.4", to:"1.6.5", status:"ok" },
            { kind:"theme", name:"twentytwentyfour", from:"1.0", to:"1.1", status:"ok" }
          ],
          errors: [],
          notes: "DEMO",
          usedBase: normalizeBase(site.url),
        };
      } else {
        // Llamada real con fallback www/no-www
        const tryCall = async (base: string) => {
          const endpoint = `${normalizeBase(base)}/wp-json/maint-agent/v1/update`;
          const resp = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Accept":"application/json",
              "X-MAINT-TOKEN": site.token,
              "User-Agent":"actualitzador-wp-dashboard"
            }
          });
          const text = await resp.text();
          const json = JSON.parse(text);
          return {
            usedBase: normalizeBase(base),
            status: resp.ok && (!json.errors || json.errors.length===0) ? "ok" : "error",
            updated: json.updated || json.items || [],
            errors: json.errors || (resp.ok ? [] : [ `HTTP ${resp.status}` ]),
            notes: json.notes || ""
          };
        };

        try {
          data = await tryCall(site.url);
        } catch {
          data = await tryCall(toggleWww(site.url));
        }
      }

      const response: UpdateResponse = {
        status: data.status,
        updated: data.updated || [],
        errors: data.errors || [],
        notes: data.notes || "",
        startedAt: stamp(started)
      };

      const rows = rowsFromUpdated(response.updated);
      const errHtml = errorsBox(response.errors);

      // Captura usando la base que funcionó (o la original)
      let preview = (site as any).screenshotUrl as string | undefined;
      if (!preview && SCREENSHOT){
        try {
          const { screenshotToDataUri } = await import("@/lib/screenshot");
          const baseForPreview = (data?.usedBase as string) || site.url;
          preview = await screenshotToDataUri(baseForPreview);
        } catch {}
      }

      const html = renderReportClassicV1({
        siteName: site.name,
        siteUrl: site.url,
        runStarted: response.startedAt,
        okCount: response.updated.length,
        warnCount: 0,
        errCount: response.errors.length,
        updatesRowsHtml: rows,
        errorsHtml: errHtml,
        previewImg: preview,
        logoDataUri
      });

      return { site, ok: true, response, reportHtml: html };
    } catch(err:any){
      return { site, ok: false, error: String(err) };
    }
  });

  const results = await Promise.allSettled(tasks);
  const payload: ApiUpdateResponse = {
    sites: results.map(r => r.status === "fulfilled" ? r.value as any : { site: {name:"?", url:"", token:""}, ok:false, error:"Unknown" })
  };
  return NextResponse.json(payload);
}
