'use client';

import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';

import styles from './page.module.css';

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

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const globalBuffer = (globalThis as unknown as {
    Buffer?: { from(data: ArrayBuffer): { toString(encoding: string): string } };
  }).Buffer;

  if (globalBuffer?.from) {
    return globalBuffer.from(buffer).toString('base64');
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  if (typeof btoa === 'function') {
    return btoa(binary);
  }

  throw new Error('No hay codificador base64 disponible en este entorno');
};

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
    setSites((current) => {
      const target = current[i];
      if (target?.invoiceUrl) {
        URL.revokeObjectURL(target.invoiceUrl);
      }
      return current.filter((_, idx) => idx !== i);
    });

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
    const blobUrl = URL.createObjectURL(file);
    setSites((current) =>
      current.map((site, idx) => {
        if (idx !== i) return site;
        if (site.invoiceUrl) {
          URL.revokeObjectURL(site.invoiceUrl);
        }
        return { ...site, invoiceUrl: blobUrl };
      })
    );
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
      const pdfBase64 = arrayBufferToBase64(pdfBuffer);

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
            base64: pdfBase64,
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
    <main className={styles.main}>
      <header className={styles.topbar}>
        <h1 className={styles.title}>Panel Actualizador WP</h1>
        {DEMO && <span className={styles.demoBadge}>DEMO</span>}
      </header>

      {/* Editor de sitios */}
      <section className={`${styles.card} ${styles.cardStack}`}>
        <div className={styles.gridHeader}>
          <div>Nombre</div>
          <div>URL</div>
          <div>Token</div>
          <div>Email destino</div>
        </div>

        {sites.map((s, i) => (
          <div className={styles.siteRow} key={i}>
            <input
              className={styles.input}
              value={s.name}
              onChange={(e) => updateSite(i, { name: e.target.value })}
            />
            <input
              className={styles.input}
              value={s.url}
              onChange={(e) => updateSite(i, { url: e.target.value })}
            />
            <input
              className={styles.input}
              value={s.token ?? ''}
              onChange={(e) => updateSite(i, { token: e.target.value })}
            />
            <div className={styles.emailCell}>
              <input
                type="email"
                className={`${styles.input} ${!s.email ? styles.inputError : ''}`}
                placeholder="cliente@dominio.com"
                value={s.email ?? ''}
                onChange={(e) => updateSite(i, { email: e.target.value })}
              />
              <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => removeSite(i)}>
                Eliminar
              </button>
            </div>
          </div>
        ))}

        <div className={styles.cardActions}>
          <button className={`${styles.btn} ${styles.btnGhost}`} onClick={addSite}>
            Añadir sitio
          </button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={busy}
            onClick={() => sites.forEach((_, idx) => doUpdate(idx))}
          >
            {busy ? 'Actualizando…' : 'Actualizar Todo'}
          </button>
        </div>
      </section>

      {/* Resultados */}
      <section className={`${styles.card} ${styles.cardStack}`}>
        <h2 className={styles.sectionTitle}>Resultados</h2>

        <div className={styles.resultsWrapper}>
          <table className={styles.resultsTable}>
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
                        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => downloadReport(r)}>
                          Descargar HTML
                        </button>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td>
                      <label className={`${styles.btn} ${styles.btnGhost}`}>
                        Cargar factura PDF
                        <input
                          className={styles.fileInput}
                          type="file"
                          accept="application/pdf"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadInvoice(i, f);
                          }}
                        />
                      </label>
                      {s.invoiceUrl && <div className={`${styles.pdfStatus} ${styles.textXs}`}>✓ PDF listo</div>}
                    </td>
                    <td>
                      <button
                        className={`${styles.btn} ${styles.btnOutline}`}
                        disabled={!s.invoiceUrl}
                        onClick={() => sendOne(i)}
                      >
                        Enviar email
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={`${styles.cardActions} ${styles.cardActionsEnd}`}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={sendAll}>
            Enviar todos
          </button>
        </div>
      </section>
    </main>
  );
}
