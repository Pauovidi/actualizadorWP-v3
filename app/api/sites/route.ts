import { NextResponse } from 'next/server';
import { dbPool } from '@/lib/db';

export const runtime = 'nodejs';

export type SiteRow = {
  id?: number;
  name: string;
  url: string;
  token: string;
  email: string;
  billingFrequency?: 'monthly' | 'quarterly';
  quarterlyMonths?: number[] | null; // e.g. [3,6,9,12]
  active?: boolean;
};

function normalizeUrl(url: string) {
  return (url || '').trim().replace(/\/+$/, '');
}

function toIntArray(v: any): number[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  return null;
}

export async function GET() {
  try {
    const pool = dbPool();
    const { rows } = await pool.query(
      `SELECT id, name, url, token, email, billing_frequency, quarterly_months, active
       FROM sites
       WHERE active = TRUE
       ORDER BY id ASC`
    );

    const sites = rows.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      token: r.token,
      email: r.email,
      billingFrequency: (r.billing_frequency || 'monthly') as 'monthly' | 'quarterly',
      quarterlyMonths: r.quarterly_months || null,
      active: r.active,
    }));

    return NextResponse.json({ ok: true, sites });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const replace = searchParams.get('replace') === '1';

    const body = (await req.json()) as { sites?: SiteRow[] };
    const sites = body?.sites || [];
    if (!Array.isArray(sites)) {
      return NextResponse.json({ ok: false, error: 'Body must be { sites: [...] }' }, { status: 400 });
    }

    // Basic validation + normalization
    const normalized: SiteRow[] = sites
      .map((s) => ({
        ...s,
        name: (s.name || '').trim(),
        url: normalizeUrl(s.url || ''),
        token: (s.token || '').trim(),
        email: (s.email || '').trim(),
        billingFrequency: (s.billingFrequency || 'monthly') as any,
        quarterlyMonths: toIntArray((s as any).quarterlyMonths),
      }))
      .filter((s) => s.name && s.url && s.token && s.email);

    const pool = dbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert provided sites
      for (const s of normalized) {
        await client.query(
          `INSERT INTO sites (name, url, token, email, billing_frequency, quarterly_months, active)
           VALUES ($1,$2,$3,$4,$5,$6,TRUE)
           ON CONFLICT (url) DO UPDATE SET
             name = EXCLUDED.name,
             token = EXCLUDED.token,
             email = EXCLUDED.email,
             billing_frequency = EXCLUDED.billing_frequency,
             quarterly_months = EXCLUDED.quarterly_months,
             active = TRUE,
             updated_at = NOW()`,
          [
            s.name,
            s.url,
            s.token,
            s.email,
            s.billingFrequency || 'monthly',
            s.billingFrequency === 'quarterly' ? s.quarterlyMonths : null,
          ]
        );
      }

      // IMPORTANT: Persistencia segura.
      // Solo desactivamos "los que no están" si el cliente lo pide explícitamente con ?replace=1.
      // Esto evita perder todo el listado por un fallo temporal del frontend (p. ej. autosave enviando [])
      if (replace) {
        const urls = normalized.map((s) => s.url);
        if (urls.length === 0) {
          throw new Error('Refusing to replace with empty sites list. Send at least 1 site or omit replace=1.');
        }
        await client.query(
          `UPDATE sites SET active = FALSE, updated_at = NOW()
           WHERE active = TRUE AND NOT (url = ANY($1::text[]))`,
          [urls]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return NextResponse.json({ ok: true, saved: normalized.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

// Compat: algunos entornos/clients pueden usar POST en vez de PUT.
export async function POST(req: Request) {
  return PUT(req);
}
