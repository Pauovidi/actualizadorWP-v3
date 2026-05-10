import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { dbPool } from '@/lib/db';

export const runtime = 'nodejs';

function sanitizeEmail(email: string) {
  return (email || '').trim().toLowerCase().replace(/[^a-z0-9@._+-]/g, '');
}

function sanitizePathPart(part: string) {
  return (part || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const email = String(form.get('email') || '').trim();
    const period = String(form.get('period') || '').trim(); // YYYY-MM or YYYY-Qn
    const file = form.get('file') as File | null;

    if (!email || !period || !file) {
      return NextResponse.json({ ok: false, error: 'Missing email, period or file' }, { status: 400 });
    }
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ ok: false, error: 'Only application/pdf allowed' }, { status: 400 });
    }

    const emailSafe = sanitizeEmail(email);
    const nameSafe = sanitizePathPart(file.name || 'factura.pdf');
    const blobPath = `invoices/${sanitizePathPart(period)}/${emailSafe}/${nameSafe}`;

    // Upload to Vercel Blob (server upload). Note: server uploads are recommended for <= 4.5MB files.
    const blob = await put(blobPath, file, { access: 'public', contentType: 'application/pdf' });

    const pool = dbPool();
    await pool.query(
      `INSERT INTO invoices (billing_email, period, file_name, blob_url)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (billing_email, period) DO UPDATE SET
         file_name = EXCLUDED.file_name,
         blob_url = EXCLUDED.blob_url,
         created_at = NOW()`,
      [emailSafe, period, file.name, blob.url]
    );

    return NextResponse.json({ ok: true, url: blob.url, fileName: file.name, period, email: emailSafe });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
