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
