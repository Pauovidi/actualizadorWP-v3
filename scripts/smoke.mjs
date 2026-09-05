import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';

async function files(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
  return nested.flat();
}

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

(async () => {
  // 1) ¿Existe el output del build?
  if (!existsSync('.next')) fail('No existe carpeta .next tras build');

  // 2) ¿Hay CSS (Tailwind/estilos globales) en el bundle?
  const cssFiles = (await files('.next/static/css')).filter(name => name.endsWith('.css'));
  if (!cssFiles.length) fail('No se generó CSS en .next/static/css — revisa globals.css/tailwind');

  // 3) ¿Compilaron las API routes clave?
  const apiUpdate = await files('.next/server/app/api/update');
  const apiSend   = await files('.next/server/app/api/send');
  if (!apiUpdate.length) fail('Falta build de /api/update');
  if (!apiSend.length)   fail('Falta build de /api/send');

  // 4) ¿Existe al menos una page compilada?
  const page = (await files('.next/server/app')).filter(name => /\/page\.[^/]+$/.test(name));
  if (!page.length) fail('No se encontró ninguna page compilada en app/');

  console.log('Smoke OK: CSS + APIs + page presentes');
})();
