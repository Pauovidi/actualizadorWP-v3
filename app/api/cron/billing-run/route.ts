import { NextResponse } from 'next/server';
import { dbPool } from '@/lib/db';
import { Buffer } from 'node:buffer';

export const runtime = 'nodejs';

type Site = {
  name: string;
  url: string;
  token: string;
  email: string;
  billing_frequency: 'monthly' | 'quarterly';
  quarterly_months: number[] | null;
};

function madridYearMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  return { year: Number(year), month: Number(month), period: `${year}-${month}` };
}

function isInvoiceDueForMonth(site: Site, month: number) {
  if (site.billing_frequency !== 'quarterly') return true; // monthly => always due
  const months = site.quarterly_months || [3, 6, 9, 12];
  return months.includes(month);
}

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${secret}`;
}

async function wpUpdate(site: Site) {
  // same logic as /api/update (simplified)
  const u = new URL(site.url);
  const hostname = u.hostname.replace(/^www\./, '');
  const candidates = new Set<string>([
    `${u.protocol}//${hostname}`,
    `${u.protocol}//www.${hostname}`,
  ]);

  let lastErr: any = null;
  for (const target of candidates) {
    try {
      const resp = await fetch(`${target}/wp-json/maint-agent/v1/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${site.token}`,
        },
        body: JSON.stringify({ screenshot: false }),
      });
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      const payload = await resp.json();
      const html = payload?.htmlReport || '<html><body>Informe vacío</body></html>';
      return {
        ok: true,
        status: payload?.status || 'OK',
        errors: payload?.errors || [],
        reportHtml: `data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`,
        reportFileName: `informe-${hostname}-${new Date().toISOString().slice(0, 10)}.html`,
      };
    } catch (e: any) {
      lastErr = e;
    }
  }
  return { ok: false, error: lastErr?.message || String(lastErr) };
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const pool = dbPool();
  const { year, month, period } = madridYearMonth();

  // Optional: ?dryRun=1 to test
  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get('dryRun') === '1';

  // Load active sites
  const { rows } = await pool.query(
    `SELECT name, url, token, email, billing_frequency, quarterly_months
     FROM sites
     WHERE active = TRUE`
  );
  const sites: Site[] = rows;

  // Group by billing email
  const byEmail = new Map<string, Site[]>();
  for (const s of sites) {
    const key = String(s.email || '').trim().toLowerCase();
    if (!key) continue;
    byEmail.set(key, [...(byEmail.get(key) || []), s]);
  }

  const origin = new URL(req.url).origin;
  const results: any[] = [];

  for (const [email, groupSites] of byEmail.entries()) {
    // Always send monthly report email.
    // Invoice is attached only when it's due (monthly always; quarterly only on configured months).
    const effectivePeriod = period; // YYYY-MM

    // We assume billing config is consistent across sites with same email.
    const cfg = groupSites[0];
    const invoiceDue = cfg ? isInvoiceDueForMonth(cfg, month) : true;

    // Idempotency: skip if already SENT
    const sentCheck = await pool.query(
      `SELECT status FROM send_runs WHERE billing_email = $1 AND period = $2`,
      [email, effectivePeriod]
    );
    if (sentCheck.rows?.[0]?.status === 'SENT') {
      results.push({ email, status: 'SKIPPED', reason: 'Already SENT' });
      continue;
    }

    // Invoice handling
    let invoice: { file_name: string; blob_url: string } | null = null;
    if (invoiceDue) {
      // Behavior selected: if invoice is due but missing, DO NOT send (block).
      const inv = await pool.query(
        `SELECT file_name, blob_url FROM invoices WHERE billing_email = $1 AND period = $2`,
        [email, effectivePeriod]
      );
      invoice = inv.rows?.[0] || null;
      if (!invoice?.blob_url) {
        await pool.query(
          `INSERT INTO send_runs (billing_email, period, status, details)
           VALUES ($1,$2,'SKIPPED',$3::jsonb)
           ON CONFLICT (billing_email, period) DO UPDATE SET status = EXCLUDED.status, details = EXCLUDED.details, created_at = NOW()`,
          [email, effectivePeriod, JSON.stringify({ reason: 'Missing invoice (required)' })]
        );
        results.push({ email, status: 'SKIPPED', reason: 'Missing invoice (required)' });
        continue;
      }
    }

    // Update all sites
    const reports: Array<{ site: { name: string; url: string }; reportHtml: string; reportFileName: string }> = [];
    const errors: any[] = [];

    for (const s of groupSites) {
      const r = await wpUpdate(s);
      if (r.ok && r.reportHtml) {
        reports.push({
          site: { name: s.name, url: s.url },
          reportHtml: r.reportHtml,
          reportFileName: r.reportFileName,
        });
      } else {
        errors.push({ site: { name: s.name, url: s.url }, error: (r as any).error || 'Unknown error' });
      }
    }

    // If invoice exists for this run, fetch and encode base64
    let pdfB64: string | null = null;
    let invoiceFileName: string | null = null;
    if (invoice?.blob_url) {
      const pdfBlob = await (await fetch(invoice.blob_url)).blob();
      const pdfBuf = Buffer.from(await pdfBlob.arrayBuffer());
      pdfB64 = pdfBuf.toString('base64');
      invoiceFileName = invoice.file_name;
    }

    if (dryRun) {
      results.push({
        email,
        status: 'DRY_RUN',
        sites: groupSites.length,
        reports: reports.length,
        invoiceDue,
        hasInvoice: Boolean(invoice?.blob_url),
        errors,
      });
      continue;
    }

    // Send grouped email via /api/send
    const resp = await fetch(`${origin}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        period: effectivePeriod,
        sites: groupSites.map((s) => ({ name: s.name, url: s.url })),
        reports: reports.map((r) => ({ fileName: r.reportFileName, dataUrl: r.reportHtml })),
        invoice: pdfB64 ? { fileName: invoiceFileName || 'factura.pdf', base64: pdfB64 } : null,
        subject: pdfB64
          ? `Informe de actualización + factura (${effectivePeriod})`
          : `Informe de actualización (${effectivePeriod})`,
        errors,
      }),
    });

    const payload = await resp.json().catch(() => ({}));

    const status = resp.ok && payload?.ok ? 'SENT' : 'ERROR';
    await pool.query(
      `INSERT INTO send_runs (billing_email, period, status, details)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (billing_email, period) DO UPDATE SET status = EXCLUDED.status, details = EXCLUDED.details, created_at = NOW()`,
      [email, effectivePeriod, status, JSON.stringify(payload)]
    );

    results.push({ email, status, invoiceDue, hasInvoice: Boolean(pdfB64), details: payload, errorsCount: errors.length });
  }

  return NextResponse.json({ ok: true, period, results });
}
