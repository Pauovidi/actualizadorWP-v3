'use client';

import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';

type Site = {
  name: string;
  url: string;         // normalizada
  token?: string;
  email?: string;      // email destino (por sitio)
  invoiceUrl?: string; // blob o url pública PDF
  lastResult?: UpdateResult | null;
};

type UpdateResult = {
  status: 'OK' | 'ERROR' | 'WARN';
  errors?: string[];
  reportHtml?: string;         // base64 data URL para descarga
  reportFileName?: string;     // sugerencia de nombre
};

const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

export default function Page() {
  const [sites, setSites] = useState<Site[]>([]);
  const [busy, setBusy] = useState(false);

  // carga/persistencia simple en localStorage
  useEffect(() => {
    const raw = localStorage.getItem('awp_sites_v32');
    if (raw) setSites(JSON.parse(raw));
  }, []);
  useEffect(() => {
    localStorage.setItem('awp_sites_v32', JSON.stringify(sites));
  }, [sites]);

  const today = useMemo(() => dayjs().format('DD/MM/YYYY'), []);

  const addSite = () =>
    setSites(s => [
      ...s,
      {
        name: 'Nuevo',
        url: 'https://',
        token: DEMO ? `demo-${Math.random().toString(36).slice(2, 8)}` : '',
        email: '',
      },
    ]);

  const removeSite = (i: number) =>
    setSites(s => s.filter((_, idx) => idx !== i));

  const updateSite = (i: number, patch: Partial<Site>) =>
    setSites(s => s.map((site, idx) => (idx === i ? { ...site, ...patch } : site)));

  const normalizeUrl = (raw: string) => {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    return `https://${trimmed.replace(/^www\./i, '')}`;
  };

  const doUpdate = async (i: number) => {
    const site = sites[i];
    if (!site?.url) return;

    setBusy(true);
    try {
      const res = await fetch('/api/update', {
        method: 'POST',
        body: JSON.stringify({
          url: normalizeUrl(site.url),
          token: site.token ?? '',
          screenshot: process.env.NEXT_PUBLIC_SCREENSHOT_ENABLED === '1',
          demo: process.env.NEXT_PUBLIC_DEMO === '1',
        }),
      });
      const json = await res.json();
      updateSite(i, { lastResult: json.data as UpdateResult });
      alert(`Actualizado ${site.name}: ${json.ok ? 'OK' : 'con incidencias'}`);
    } catch (e: any) {
      updateSite(i, {
        lastResult: { status: 'ERROR', errors: [String(e)], reportHtml: undefined },
      });
      alert(`Error actualizando ${site.name}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = (r?: UpdateResult | null) => {
    if (!r?.reportHtml) return;
    const a = document.createElement('a');
    a.href = r.reportHtml;
    a.download = r.reportFileName || 'informe.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const uploadInvoice = async (i: number, file: File) => {
    // en v3.2 mantenemos el PDF en memoria (url local)
    const blobUrl = URL.createObjectURL(file);
    updateSite(i, { invoiceUrl: blobUrl });
  };

  const sendOne = async (i: number) => {
    const site = sites[i];
    if (!site) return;

    if (!site.invoiceUrl) {
      alert(`Falta factura PDF en ${site.name}`);
      return;
    }

    try {
      setBusy(true);
      // obtenemos el PDF como blob para adjuntarlo
      const pdfBlob = await (await fetch(site.invoiceUrl)).blob();
      const pdfBuffer = await pdfBlob.arrayBuffer();

      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site: {
            name: site.name,
            url: normalizeUrl(site.url),
            email: site.email, // <- por sitio
          },
          reportHtml: site.lastResult?.reportHtml || null,
          reportFileName: site.lastResult?.reportFileName || 'informe.html',
          invoice: {
            fileName: `factura-${dayjs().format('YYYYMMDD')}.pdf`,
            // pasamos el PDF en base64
            base64: Buffer.from(pdfBuffer).toString('base64'),
          },
          subject: `Informe y factura — ${site.name} (${today})`,
        }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Fallo desconocido');
      alert(`Enviado ${site.name}: OK`);
    } catch (e: any) {
      alert(`Error enviando ${site.name}: "${String(e?.message || e)}"`);
    } finally {
      setBusy(false);
    }
  };

  const sendAll = async () => {
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (!s.invoiceUrl) continue; // respeta regla: solo envía con factura
      // eslint-disable-next-line no-await-in-loop
      await sendOne(i);
    }
  };

  return (
    <main className="max-w-6xl mx-auto p-6 text-slate-100">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-4xl font-extrabold">Panel Actualizador WP</h1>
        {DEMO && (
          <span className="px-2 py-1 rounded bg-slate-700 text-xs">DEMO</span>
        )}
      </header>

      {/* Editor de sitios */}
      <section className="mb-8 rounded-2xl bg-slate-900/60 p-5 shadow-lg border border-slate-800">
        <div className="grid grid-cols-12 gap-3 items-center">
          <div className="col-span-3 font-semibold">Nombre</div>
          <div className="col-span-4 font-semibold">URL</div>
          <div className="col-span-2 font-semibold">Token</div>
          <div className="col-span-3 font-semibold">Email destino</div>

          {sites.map((s, i) => (
            <div className="contents" key={i}>
              <input
                className="col-span-3 input"
                value={s.name}
                onChange={(e) => updateSite(i, { name: e.target.value })}
              />
              <input
                className="col-span-4 input"
                value={s.url}
                onChange={(e) => updateSite(i, { url: e.target.value })}
              />
              <input
                className="col-span-2 input"
                value={s.token ?? ''}
                onChange={(e) => updateSite(i, { token: e.target.value })}
              />
              <div className="col-span-3 flex items-center gap-2">
                <input
                  type="email"
                  className={`input flex-1 ${!s.email ? 'input-error' : ''}`}
                  placeholder="cliente@dominio.com"
                  value={s.email ?? ''}
                  onChange={(e) => updateSite(i, { email: e.target.value })}
                />
                <button className="btn btn-ghost" onClick={() => removeSite(i)}>
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-3">
          <button className="btn btn-ghost" onClick={addSite}>Añadir sitio</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => sites.forEach((_, i) => doUpdate(i))}>
            {busy ? 'Actualizando…' : 'Actualizar Todo'}
          </button>
        </div>
      </section>

      {/* Resultados */}
      <section className="rounded-2xl bg-slate-900/60 p-5 shadow-lg border border-slate-800">
        <h2 className="text-2xl font-bold mb-4">Resultados</h2>

        <div className="overflow-x-auto">
          <table className="results-table w-full">
            <thead>
              <tr>
                <th>Sitio</th>
                <th>Estado</th>
                <th>Errores</th>
                <th>Informe</th>
                <th>Factura</th>
                <th>Enviar email</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s, i) => {
                const r = s.lastResult;
                return (
                  <tr key={i}>
                    <td>{s.name}</td>
                    <td>{r?.status ?? '-'}</td>
                    <td>{r?.errors?.length ? r.errors.join(', ') : '-'}</td>
                    <td>
                      {r?.reportHtml ? (
                        <button className="btn btn-secondary" onClick={() => downloadReport(r)}>
                          Descargar HTML
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <label className="btn btn-ghost">
                        Cargar factura PDF
                        <input
                          className="hidden"
                          type="file"
                          accept="application/pdf"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadInvoice(i, f);
                          }}
                        />
                      </label>
                      {s.invoiceUrl && <div className="text-xs mt-1">✓ PDF listo</div>}
                    </td>
                    <td>
                      <button className="btn btn-outline" disabled={!s.invoiceUrl} onClick={() => sendOne(i)}>
                        Enviar email
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <button className="btn btn-primary" onClick={sendAll}>Enviar todos</button>
        </div>
      </section>
    </main>
  );
}
