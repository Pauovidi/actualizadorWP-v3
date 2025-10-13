import { existsSync } from 'node:fs';
import { glob } from 'node:fs/promises';

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

(async () => {
  // 1) ¿Existe el output del build?
  if (!existsSync('.next')) fail('No existe carpeta .next tras build');

  // 2) ¿Hay CSS (Tailwind/estilos globales) en el bundle?
  const cssFiles = await glob('.next/static/css/*.css', { dot: true });
  if (!cssFiles.length) fail('No se generó CSS en .next/static/css — revisa globals.css/tailwind');

  // 3) ¿Compilaron las API routes clave?
  const apiUpdate = await glob('.next/server/app/api/update/**/*', { dot: true });
  const apiSend   = await glob('.next/server/app/api/send/**/*', { dot: true });
  if (!apiUpdate.length) fail('Falta build de /api/update');
  if (!apiSend.length)   fail('Falta build de /api/send');

  // 4) ¿Existe al menos una page compilada?
  const page = await glob('.next/server/app/**/page.*', { dot: true });
  if (!page.length) fail('No se encontró ninguna page compilada en app/');

  console.log('Smoke OK: CSS + APIs + page presentes');
})();
