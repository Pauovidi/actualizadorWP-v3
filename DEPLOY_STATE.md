# 🧠 Estado de Verdad — Actualitzador WP v3.3  
### *Build Config + Deploy Agent Ready (Devestial Stack)*

## 🎯 Objetivo  
Garantizar una configuración mínima, limpia y estable para despliegues automáticos en Vercel.  
Este archivo sirve como fuente de verdad para el futuro Agente de Deploy Devestial, encargado de mantener builds exitosos.

## ⚙️ Entorno técnico

| Elemento | Valor |
|-----------|--------|
| **Framework** | Next.js 14.2.3 |
| **Node.js** | 20.x |
| **TypeScript** | 5.5.4 |
| **Build command** | `NEXT_DISABLE_ESLINT=1 NEXT_DISABLE_TYPECHECK=1 next build` |
| **Deploy Platform** | Vercel (auto-detect, sin vercel.json) |
| **Runtime** | Serverless Functions (auto) |
| **Modo lint/type-check** | Desactivado para producción |
| **Directorio raíz** | `/` |

## 🧱 Dependencias críticas

| Tipo | Paquete | Versión | Rol |
|------|----------|----------|-----|
| Core | next | 14.2.3 | Framework principal |
| Core | react | 18.3.1 | Frontend |
| Core | react-dom | 18.3.1 | Renderizado |
| Utilidad | dayjs | ^1.11.13 | Fechas |
| Email | nodemailer | ^6.9.12 | SMTP / envío de informes |
| Capturas | puppeteer-core | ^22.15.0 | Motor de capturas headless |
| Capturas | @sparticuz/chromium | ^123.0.2 | Chromium optimizado para serverless |

## 🧩 DevDependencies
| Paquete | Rol |
|----------|-----|
| typescript | compilador TS |
| @types/node | tipos Node |
| @types/react | tipos React |
| @types/react-dom | tipos React DOM |

## 🧰 Configuración clave
- Sin `vercel.json`: Vercel detecta automáticamente Node 20.x y Next.js.  
- Sin `postinstall` ni `ensure-types`: innecesarios en entorno CI/CD.  
- Sin `zod`: validaciones internas simplificadas.  
- Estructura estándar Next 14 (`/app`, `/api`, `/public`).

## 🚀 Flujo de Deploy (Agente Devestial)
1. Clonar repo desde GitHub.  
2. Validar `package.json`.  
3. Confirmar ausencia de `vercel.json`.  
4. Ejecutar build vía API de Vercel.  
5. Monitorear logs, detectar errores, autocorregir, redeploy.

## 🔒 Reglas inviolables
✅ No añadir `vercel.json` sin justificación.  
✅ No reactivar ESLint ni Type-Check en producción.  
✅ No eliminar dependencias críticas (`dayjs`, `nodemailer`, `puppeteer-core`, `@sparticuz/chromium`).  
✅ Mantener Node 20.x como versión fija.  

**Última revisión:** v3.3 — Octubre 2025  
**Responsable técnico:** Pau Ovidi (Devestial)

