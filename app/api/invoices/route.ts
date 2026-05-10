import { NextResponse } from 'next/server';
import { dbPool } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const period = String(searchParams.get('period') || '').trim();
    if (!period) {
      return NextResponse.json({ ok: false, error: 'Missing period query param' }, { status: 400 });
    }
    const pool = dbPool();
    const { rows } = await pool.query(
      `SELECT billing_email, period, file_name, blob_url, created_at
       FROM invoices
       WHERE period = $1
       ORDER BY billing_email ASC`,
      [period]
    );

    return NextResponse.json({ ok: true, invoices: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
