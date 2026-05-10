# Email deliverability - actualizador-wp-automatizado

## Alcance

Este documento cubre solo el envio de emails de `actualizador-wp-automatizado` mediante `POST /api/send`.
No incluye Quipu, cambios de facturas, Blob, Neon/Postgres ni cron.

## Variables esperadas

```env
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_SECURE=0
MAIL_USER=...
MAIL_PASS=...
MAIL_FROM="Actualizador WP <no-reply@tu-dominio.com>"
MAIL_REPLY_TO="soporte@tu-dominio.com"
MAIL_ENVELOPE_FROM=no-reply@tu-dominio.com
EMAIL_TO_DEFAULT=destino-pruebas@example.com
```

Alias legacy aceptados por compatibilidad:

```env
SMTP_HOST=...
SMTP_PORT=...
SMTP_SECURE=...
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=...
EMAIL_FROM=...
EMAIL_REPLY_TO=...
EMAIL_ENVELOPE_FROM=...
```

Si `RESEND_API_KEY` existe, el endpoint conserva el fallback legacy cuando SMTP falla.

## Comportamiento del endpoint

- Payload invalido: `400` con `correlationId`, sin intentar SMTP.
- Envio correcto: `200` con `correlationId`, `id`, `accepted` y `rejected` si el transporte lo devuelve.
- Duplicado best-effort durante 10 minutos: `409` con `correlationId` y `duplicateOf`.
- Configuracion SMTP ausente: `500` publico, sin filtrar secretos.
- Adjuntos remotos por URL: `400`.
- Adjuntos base64 invalidos o demasiado grandes: `400`.

El endpoint emite logs estructurados sin secretos:

- `email_send_invalid_payload`
- `email_send_attempt`
- `email_send_success`
- `email_send_error`
- `email_send_duplicate_blocked`

## Validacion de preview sin envio real

```bash
vercel inspect <preview-url>
cmd /c vercel curl / --deployment <preview-url> -- --head
vercel curl / --deployment <preview-url>
vercel curl /api/sites --deployment <preview-url>
vercel curl "/api/invoices?period=2026-05" --deployment <preview-url>
cmd /c vercel curl /api/send --deployment <preview-url> -- --include --request POST --header "Content-Type: application/json" --data "{}"
```

La ultima llamada debe devolver `400` con `correlationId` y no debe crear logs 5xx.

## Herramienta temporal de prueba aislada

El preview puede habilitar un panel temporal "Prueba de emails" sin tocar clientes, webs, facturas, Blob, Neon ni cron.

Variables necesarias en Preview:

```env
ENABLE_EMAIL_TEST_PANEL=true
EMAIL_TEST_TOKEN=<token-temporal-largo>
NEXT_PUBLIC_ENABLE_EMAIL_TEST_PANEL=true
```

El token no debe ser `NEXT_PUBLIC_*`; el operador lo introduce manualmente en el panel y se envia solo como header `x-email-test-token`. `NEXT_PUBLIC_ENABLE_EMAIL_TEST_PANEL` no es secreto: solo permite que el HTML del preview muestre el panel desde la primera carga.

Validaciones:

```bash
vercel curl /api/send-test --deployment <preview-url>
cmd /c vercel curl /api/send-test --deployment <preview-url> -- --include --request POST --header "Content-Type: application/json" --header "x-email-test-token: <token>" --data "{\"recipients\":[\"test@example.com\"]}"
```

La herramienta:

- solo funciona si `ENABLE_EMAIL_TEST_PANEL=true`;
- exige `EMAIL_TEST_TOKEN`;
- rechaza `VERCEL_ENV=production`;
- limita la prueba a 4 destinatarios manuales;
- no acepta adjuntos;
- no llama a `/api/update`, `/api/sites`, `/api/invoices`, Blob, Neon ni cron;
- registra `email_test_attempt`, `email_test_success` y `email_test_error`.

## Checklist externo

- SPF autoriza el host SMTP real.
- DKIM activo para el dominio de `MAIL_FROM`.
- DMARC publicado y alineado con `MAIL_FROM` y `MAIL_ENVELOPE_FROM`.
- Return-Path/envelope sender aceptado por el proveedor.
- Bounces y quejas accesibles en el proveedor.
- Reputacion del dominio/IP revisada.
- Pruebas reales en Gmail/Outlook con headers completos.
- Tamano de adjuntos y cuotas SMTP confirmados.

La entregabilidad real no puede validarse solo desde el repo: requiere envio a buzones controlados, revisar inbox/spam y copiar headers completos.
