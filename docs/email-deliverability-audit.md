# Auditoria de email deliverability

Fecha: 2026-05-09
Repo: `Pauovidi/actualizadorWP-v3`
Proyecto Vercel vinculado: `devestial/actualizador-wp`

## Alcance

Esta auditoria cubre solo el sistema de envio de emails de Actualizador WP. No incluye Quipu ni cambios de negocio fuera del flujo `/api/send`.

## Mapa del sistema actual

- UI de envio: `app/page.tsx`
- Endpoint de envio: `app/api/send/route.ts`
- Transporte SMTP/Nodemailer: `lib/email.ts`
- Generacion del informe HTML adjunto: `app/api/update/route.ts`
- Dependencia de envio: `nodemailer`

El proveedor real es SMTP mediante Nodemailer. Vercel tiene variables `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM` y `PUBLIC_BASE_URL` configuradas como cifradas.

## Cambios aplicados

- Centralizado el transporte SMTP en `lib/email.ts`.
- Sustituido el remitente hardcodeado por `MAIL_FROM`, con fallback historico a `pau@devestial.com`.
- Anadido `MAIL_REPLY_TO` y `MAIL_ENVELOPE_FROM` opcionales.
- Anadida version `text/plain` junto al HTML.
- Anadidos `correlationId`, headers `X-ActualizadorWP-Correlation-ID` y logs estructurados.
- Anadida respuesta con `messageId`, `accepted`, `rejected` y `correlationId`.
- Anadida proteccion best-effort contra doble envio durante 10 minutos.
- Anadidos limites de tamano para informe HTML, adjuntos y numero de adjuntos.
- Bloqueados adjuntos remotos por URL.
- Limitado `reportUrl` remoto al mismo origen configurado.
- Actualizada la UI para enviar una clave de idempotencia y mostrar el ID de correlacion.
- Actualizado README con las variables SMTP reales.

## Riesgos priorizados

1. Endpoint `/api/send` sin autenticacion fuerte. Puede actuar como relay SMTP si la app queda accesible publicamente. Requiere token interno, sesion o proteccion de acceso.
2. Deliverability depende de DNS/proveedor: SPF, DKIM, DMARC, alineacion de `MAIL_FROM` y reputacion SMTP no se pueden validar solo desde el repo.
3. No hay persistencia servidor-side del estado de envio. La deduplicacion actual es best-effort en memoria y el ultimo estado sigue en `localStorage`.
4. No hay cola ni reintentos controlados. Los reintentos manuales quedan trazados, pero no hay scheduler ni backoff persistente.
5. El informe y la factura viajan como adjuntos; mensajes grandes o frecuentes pueden afectar cuota y reputacion.

## Checklist externo DNS/proveedor

- SPF autoriza el servidor SMTP usado por `MAIL_HOST`.
- DKIM activo para el dominio de `MAIL_FROM`.
- DMARC publicado con politica al menos `p=none` y reportes activos.
- Dominio de `MAIL_FROM` alineado con DKIM/SPF y el envelope sender.
- `MAIL_ENVELOPE_FROM` usa un dominio permitido por el proveedor SMTP.
- Reverse DNS y HELO/EHLO correctos si el SMTP es dedicado.
- Reputacion del dominio/IP revisada en Google Postmaster Tools, Microsoft SNDS o panel equivalente.
- Bounces y quejas disponibles en el proveedor.
- Limites de cuota y tamano de adjuntos documentados.
- El contenido transaccional no se mezcla con campanas comerciales.

## Validacion post-deploy en Vercel

1. Confirmar variables sin imprimir secretos:
   `vercel env ls`
2. Confirmar disponibilidad de variables sin imprimir valores:
   `vercel env run -- node -e "const r=['MAIL_HOST','MAIL_PORT','MAIL_SECURE','MAIL_USER','MAIL_PASS','MAIL_FROM','PUBLIC_BASE_URL']; console.log(Object.fromEntries(r.map(n=>[n,Boolean(process.env[n])])));"`
3. Si hay que reproducir localmente con secretos, usar `vercel env pull .env.local` solo en local. El archivo queda ignorado por Git.
4. Desplegar la rama de PR en preview.
5. En preview, enviar un email real a una cuenta controlada.
6. Copiar el `correlationId` mostrado en la UI.
7. Revisar logs de Vercel filtrando por `email_send_attempt`, `email_send_success` o `email_send_error`.
8. Confirmar en logs `accepted > 0`, `rejected = 0` y `messageId`.
9. Revisar cabeceras del email recibido: SPF, DKIM, DMARC, `From`, `Return-Path` y los headers `X-ActualizadorWP-Correlation-ID`.
10. Probar doble click o segundo envio inmediato: debe bloquearse como duplicado.
11. Probar una factura PDF superior al limite esperado: debe rechazarse sin intentar SMTP.

## Pendiente fuera del repo

- Validar DNS y reputacion del proveedor SMTP.
- Confirmar si el remitente final debe ser `devestial.com` u otro dominio.
- Definir autenticacion para operadores del panel.
- Decidir si se necesita persistencia real de envios en base de datos.
- Decidir si se requiere cola/reintentos para entregas criticas.
