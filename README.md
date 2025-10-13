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
- Botones por sitio: **Cargar factura** (guarda local, no servidor) y **Enviar email** (usa Resend).
- **Enviar todos**: solo envía los sitios que **tienen factura**; avisa de los que no.

## Variables de entorno
```
DEMO_MODE=1
NEXT_PUBLIC_DEMO=1
NEXT_PUBLIC_SHOW_SERVER_BUTTONS=0
SCREENSHOT_ENABLED=1
RESEND_API_KEY=...
EMAIL_FROM="Actualitzador <no-reply@tu-dominio.com>"
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

## Cómo actualizar la rama Codex y fusionar en `main`
Sigue este flujo cuando quieras incorporar los cambios de esta rama al despliegue principal en Vercel:

1. **Sincroniza `main` en local**
   ```bash
   git checkout main
   git pull origin main
   ```
2. **Actualiza la rama de trabajo** (por ejemplo `work` o `chore/sync-codex-branch-into-main`)
   ```bash
   git checkout work
   git merge main
   # o bien
   git rebase main
   ```
   Resuelve cualquier conflicto y confirma el merge/rebase.
3. **Empuja la rama actualizada**
   ```bash
   git push
   ```
4. **Abre o actualiza el Pull Request hacia `main`**
   - Usa el título `chore: sync Codex branch into main (remove workflows, align deploy)` para mantener el historial coherente.
   - Comprueba que el PR elimine `.github/workflows/` y conserve los archivos clave (`app/`, `next.config.js`, `scripts/smoke.mjs`, `public/`, `package.json`, `tsconfig.json`, `types/`, `lib/`, `DEPLOY_STATE.md`).
5. **Fusiona el PR**
   - Si está disponible, selecciona **Squash & merge**. En caso contrario, usa el método que permita la protección de rama.
   - Si la rama `main` está protegida, solicita la aprobación necesaria y deja el PR listo (checks verdes y sin conflictos).
6. **Verifica Vercel**
   - Confirma que el proyecto despliega desde la rama `main` con Node.js 20.x.
   - Revisa que el *Root Directory* sea el de la raíz del repo y que las variables (`SMTP`, tokens, etc.) sigan definidas.

## Comandos de verificación
- `npm run lint`: ejecuta las reglas de ESLint recomendadas por Next.js para detectar problemas comunes antes de hacer deploy.
