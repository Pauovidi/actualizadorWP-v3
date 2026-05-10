# Actualitzador WP — Dashboard v3 (simple)

## DEMO
- Autocompleta **token falso** cuando escribes una URL.
- Genera **informes simulados** y puede hacer **capturas** si `SCREENSHOT_ENABLED=1`.
- Botones por sitio: **Cargar factura** (guarda local, no servidor) y **Enviar email** (usa SMTP con Nodemailer).
- **Enviar todos**: solo envía los sitios que **tienen factura**; avisa de los que no.

## Variables
```
DEMO_MODE=1
NEXT_PUBLIC_DEMO=1
NEXT_PUBLIC_SHOW_SERVER_BUTTONS=0
SCREENSHOT_ENABLED=1
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_SECURE=0
MAIL_USER=...
MAIL_PASS=...
MAIL_FROM="Actualizador WP <no-reply@tu-dominio.com>"
MAIL_REPLY_TO="soporte@tu-dominio.com"
MAIL_ENVELOPE_FROM=no-reply@tu-dominio.com
EMAIL_TO_DEFAULT=...
```


### Campo de email por sitio
En la parte superior ahora verás la columna **Email destino**. Si se deja vacío, el backend usará `EMAIL_TO_DEFAULT`.

## Cómo conectar con tu repositorio de GitHub
Realiza estos pasos **desde la raíz del proyecto** (la carpeta donde está este archivo `README.md`).

> 💡 Para situarte en esa carpeta abre una **terminal** (por ejemplo, la integrada en VS Code) y ejecuta:
> ```bash
> cd /ruta/al/proyecto/actualizadorWP-v3
> pwd
> ```
> El comando `pwd` debe devolver una ruta que termine en `actualizadorWP-v3`. En ese mismo terminal ya puedes seguir con los pasos.

1. Añade el remoto que apunta a tu repositorio en GitHub (solo la primera vez):
   ```bash
   git remote add origin https://github.com/tu-usuario/tu-repo.git
   ```
2. Comprueba que quedó registrado:
   ```bash
   git remote -v
   ```
   Deberías ver las URLs de `origin` para `fetch` y `push`.
3. Envía la rama actual al remoto:
   ```bash
   git push -u origin work
   ```
   La opción `-u` deja configurada la rama remota para futuros `git push`/`git pull` sin parámetros.

Si trabajas en otra rama, sustituye `work` por el nombre de la rama que quieras publicar.

## Comandos de verificación
- `npm run lint`: ejecuta las reglas de ESLint recomendadas por Next.js para detectar problemas comunes antes de hacer deploy.

## Email deliverability

- El envío real está en `app/api/send/route.ts`.
- El transporte SMTP/Nodemailer está centralizado en `lib/email.ts`.
- Cada respuesta relevante incluye `correlationId`; úsalo para buscar `email_send_attempt`, `email_send_success`, `email_send_error` o `email_send_duplicate_blocked` en logs de Vercel.
- Cada email incluye HTML y `text/plain`.
- `MAIL_ENVELOPE_FROM` se usa como `envelope.from` para alinear el Return-Path si el proveedor SMTP lo permite.
- Los adjuntos remotos por URL se rechazan; el panel envía informes/facturas como base64.

Para validar sin enviar correos reales:

```bash
curl -i -X POST "$PREVIEW_URL/api/send" \
  -H "Content-Type: application/json" \
  --data "{}"
```

La respuesta esperada para payload vacío es `400` con `correlationId`.
