# Actualitzador WP — Dashboard v3 (simple)

## DEMO
- Autocompleta **token falso** cuando escribes una URL.
- Genera **informes simulados** y puede hacer **capturas** si `SCREENSHOT_ENABLED=1`.
- Botones por sitio: **Cargar factura** (guarda local, no servidor) y **Enviar email** (usa Resend).
- **Enviar todos**: solo envía los sitios que **tienen factura**; avisa de los que no.

## Variables
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
Realiza estos pasos **desde la raíz del proyecto** (la carpeta donde está este archivo `README.md`). Si estás utilizando una terminal integrada en tu editor, asegúrate de que el prompt muestra `actualizadorWP-v3` antes del símbolo `#` o `$`.

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
