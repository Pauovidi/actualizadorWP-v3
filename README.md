# Actualitzador WP — Dashboard v3 (simple)

## Deploy
- **Fuente**: rama `main` (Vercel toma esta rama como origen del despliegue).
- **Node.js**: `20.x` (configurado en `package.json` y en el proyecto de Vercel).
- **Scripts disponibles**:
  - `npm run dev`
  - `npm run build`
  - `npm run start`
  - `npm run smoke`
- **Nota**: el `postinstall` usa redirección POSIX (`>/dev/null 2>&1`). En Windows puede fallar; en Vercel y entornos Unix funciona sin ajustes.

## DEMO
- Autocompleta **token falso** cuando escribes una URL.
- Genera **informes simulados** y puede hacer **capturas** si `SCREENSHOT_ENABLED=1`.
- Botones por sitio: **Cargar factura** (guarda local, no servidor) y **Enviar email** (usa SMTP con Nodemailer).
- **Enviar todos**: solo envía los sitios que **tienen factura**; avisa de los que no.

## Variables de entorno
```
DEMO_MODE=1
NEXT_PUBLIC_DEMO=1
NEXT_PUBLIC_SHOW_SERVER_BUTTONS=0
SCREENSHOT_ENABLED=1
PUBLIC_BASE_URL=https://actualizador-wp-v3.vercel.app
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_SECURE=0
MAIL_USER=...
MAIL_PASS=...
MAIL_FROM="Actualitzador WP <no-reply@tu-dominio.com>"
MAIL_REPLY_TO="soporte@tu-dominio.com"
MAIL_ENVELOPE_FROM=no-reply@tu-dominio.com
```

### Campo de email por sitio
En la parte superior verás la columna **Email destino**. Es obligatorio para enviar: el backend no usa destinatarios por defecto.

### Envío de emails
- El envío real está en `app/api/send/route.ts`.
- El transporte SMTP está centralizado en `lib/email.ts`.
- Cada envío devuelve `correlationId` y `messageId`; usa ese `correlationId` para buscar logs en Vercel.
- Cada email incluye versión HTML y `text/plain`, y bloquea duplicados equivalentes durante una ventana corta.
- No se aceptan adjuntos remotos por URL; la UI envía facturas como base64 y el informe generado por la app.

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
