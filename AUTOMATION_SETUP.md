# Automatización (mensual) — Actualitzador WP (Vercel UI)

Este repo añade:

- Persistencia de webs en **Postgres** (para que no dependas del navegador).
- Subida de **facturas PDF** a **Vercel Blob** (1 por email/cliente y periodo).
- Endpoint de **cron** que:
  1) actualiza todas las webs,
  2) agrupa por email,
  3) adjunta informes + factura,
  4) envía 1 correo por cliente,
  5) evita duplicados guardando un log (`send_runs`).

## SQL de tablas

Ver: `scripts/sql/001_init.sql` (ejecútalo en tu Postgres desde Vercel → Storage → Data/Query).

## Endpoints nuevos

- `GET /api/sites` → devuelve sitios activos desde Postgres
- `PUT /api/sites` → guarda lista completa (upsert por URL)
- `POST /api/invoices/upload` → multipart/form-data: `email`, `period`, `file` (PDF)
- `GET /api/invoices?period=YYYY-MM` → lista facturas del periodo
- `POST /api/cron/billing-run` → ejecución del cron (requiere header Authorization Bearer)

## Variables de entorno

- Base de datos: `DATABASE_URL` (o `POSTGRES_URL`)
- Blob: `BLOB_READ_WRITE_TOKEN` (la crea Vercel al conectar Blob)
- Cron: `CRON_SECRET`
- Email (SMTP): `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
  - Alternativa: `RESEND_API_KEY`

## Cron (Vercel)

`vercel.json` incluye un cron mensual el día 1 a las 05:10 UTC:
- `"/api/cron/billing-run"` → `"10 5 1 * *"`

Ajusta si quieres otro horario.

## Modo prueba (dry run)

Puedes invocar manualmente:
`POST /api/cron/billing-run?dryRun=1`
con `Authorization: Bearer <CRON_SECRET>`

Devuelve qué enviaría sin mandar correos.

## Facturación mensual vs trimestral

En el panel de **Facturas** (agrupado por email) puedes marcar cada cliente como:

- **Mensual**: el cron exige factura **todos los meses** (`YYYY-MM`). Si falta, ese cliente **no recibe** el correo de ese mes.
- **Trimestral**: eliges los **4 meses** en los que toca factura. En esos meses, si falta la factura, el cliente **no recibe** el correo. En los otros meses, el cron envía **solo los informes** (sin factura).

La subida de factura admite **click** o **drag & drop**.
