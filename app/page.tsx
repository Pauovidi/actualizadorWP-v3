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
  invoiceName?: string;
  lastResult?: UpdateResult | null;
  lastSend?: SendResult | null;
};

type UpdateResult = {
  status: 'OK' | 'ERROR' | 'WARN';
  errors?: string[];
  reportHtml?: string;         // base64 data URL para descarga
  reportFileName?: string;     // sugerencia de nombre
  at: string;                  // ISO date
};

type SendResult = {
  status: 'OK' | 'ERROR';
  via?: string;
  error?: string;
  at: string;
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
    const raw =
      localStorage.getItem('awp_sites_v33') ||
      localStorage.getItem('awp_sites_v32');
    if (raw) setSites(JSON.parse(raw));
  }, []);
  useEffect(() => {
    localStorage.setItem('awp_sites_v33', JSON.stringify(sites));
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

  const doUpdate = async (i: number, manageBusy = true) => {
    const site = sites[i];
    if (!site?.url) return;

    if (manageBusy) setBusy(true);
    updateSite(i, { lastResult: null });
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
      let json: any = null;
      try {
        json = await res.json();
      } catch (parseErr) {
        json = null;
      }

      if (!res.ok || !json?.ok) {
        const errorMessage =
          json?.error || `${res.status} ${res.statusText}`;
        updateSite(i, {
          lastResult: {
            status: 'ERROR',
            errors: [errorMessage],
            reportHtml: undefined,
            reportFileName: undefined,
            at: new Date().toISOString(),
          },
        });
        alert(`Actualizado ${site.name}: con incidencias ("${errorMessage}")`);
        return;
      }

      const payload = json.data as any;
      const rawErrors = payload?.errors;
      const normalizedErrors = Array.isArray(rawErrors)
        ? rawErrors.map((err: unknown) => String(err))
        : rawErrors
        ? [String(rawErrors)]
        : [];

      const reportHtmlRaw =
        payload?.reportHtml ||
        payload?.htmlReport ||
        payload?.report?.html ||
        payload?.report?.base64 ||
        payload?.report;

      let reportDataUrl: string | undefined;
      if (typeof reportHtmlRaw === 'string') {
        if (reportHtmlRaw.startsWith('data:')) {
          reportDataUrl = reportHtmlRaw;
        } else if (/[<>]/.test(reportHtmlRaw)) {
          if (typeof TextEncoder !== 'undefined') {
            reportDataUrl = `data:text/html;base64,${arrayBufferToBase64(
              new TextEncoder().encode(reportHtmlRaw).buffer
            )}`;
          } else {
            const bytes = new Uint8Array([...reportHtmlRaw].map((c) => c.charCodeAt(0)));
            reportDataUrl = `data:text/html;base64,${arrayBufferToBase64(bytes.buffer)}`;
          }
        } else {
          reportDataUrl = `data:text/html;base64,${reportHtmlRaw}`;
        }
      }

      const fileName =
        payload?.reportFileName ||
        payload?.report?.fileName ||
        `informe-${new Date().toISOString().slice(0, 10)}.html`;

      updateSite(i, {
        lastResult: {
          status: payload?.status ?? 'OK',
          errors: normalizedErrors,
          reportHtml: reportDataUrl,
          reportFileName: fileName,
          at: new Date().toISOString(),
        },
      });
      alert(`Actualizado ${site.name}: ${payload?.status ?? 'OK'}`);
    } catch (e: any) {
      updateSite(i, {
        lastResult: {
          status: 'ERROR',
          errors: [String(e)],
          reportHtml: undefined,
          reportFileName: undefined,
          at: new Date().toISOString(),
        },
      });
      alert(`Error actualizando ${site.name}: ${String(e)}`);
    } finally {
      if (manageBusy) setBusy(false);
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
        return { ...site, invoiceUrl: blobUrl, invoiceName: file.name, lastSend: null };
      })
    );
  };

  const sendOne = async (i: number, manageBusy = true) => {
    const site = sites[i];
    if (!site) return;

    if (!site.invoiceUrl) {
      alert(`Falta factura PDF en ${site.name}`);
      return;
    }

    try {
      if (manageBusy) setBusy(true);
      updateSite(i, { lastSend: null });
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
            fileName: site.invoiceName || `factura-${dayjs().format('YYYYMMDD')}.pdf`,
            base64: pdfBase64,
          },
          subject: `Informe y factura — ${site.name} (${today})`,
        }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Fallo desconocido');
      updateSite(i, {
        lastSend: {
          status: 'OK',
          via: json.via,
          at: new Date().toISOString(),
        },
      });
      alert(`Enviado ${site.name}: OK`);
    } catch (e: any) {
      updateSite(i, {
        lastSend: {
          status: 'ERROR',
          error: String(e?.message || e),
          at: new Date().toISOString(),
        },
      });
      alert(`Error enviando ${site.name}: "${String(e?.message || e)}"`);
    } finally {
      if (manageBusy) setBusy(false);
    }
  };

  const sendAll = async () => {
    setBusy(true);
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (!s.invoiceUrl) continue; // respeta regla: solo envía con factura
      // eslint-disable-next-line no-await-in-loop
      await sendOne(i, false);
    }
    setBusy(false);
  };

  return (
    <main className={styles.main}>
      {DEMO && <span className={styles.demoBadge}>DEMO</span>}

      <header className={styles.topbar}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Panel Actualizador WP</h1>
          {DEMO && (
            <p className={styles.demoLegend}>
              Modo demo activo: los informes se generan con datos de ejemplo y no se
              envían correos reales.
            </p>
          )}
        </div>
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
            onClick={async () => {
              setBusy(true);
              for (let idx = 0; idx < sites.length; idx++) {
                // eslint-disable-next-line no-await-in-loop
                await doUpdate(idx, false);
              }
              setBusy(false);
            }}
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
                <th>Último envío</th>
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
                    <td>
                      {r ? (
                        <div className={styles.statusTag} data-status={r.status}>
                          {r.status}
                        </div>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                      {r?.at && (
                        <span className={styles.timestamp}>{dayjs(r.at).format('HH:mm')}</span>
                      )}
                    </td>
                    <td className={styles.alignLeft}>
                      {r?.errors?.length ? (
                        <ul className={styles.errorList}>
                          {r.errors.map((err, idx) => (
                            <li key={idx}>{err}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td>
                      {r?.reportHtml ? (
                        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => downloadReport(r)}>
                          Descargar HTML
                        </button>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={styles.alignLeft}>
                      {s.lastSend ? (
                        <div className={styles.sendStatus} data-status={s.lastSend.status}>
                          <span>
                            {s.lastSend.status === 'OK'
                              ? `OK${s.lastSend.via ? ` · ${s.lastSend.via}` : ''}`
                              : 'ERROR'}
                          </span>
                          {s.lastSend.error && <p>{s.lastSend.error}</p>}
                          <time>{dayjs(s.lastSend.at).format('HH:mm')}</time>
                        </div>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={styles.alignLeft}>
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
                      {s.invoiceName && (
                        <div className={styles.fileName} title={s.invoiceName}>
                          {s.invoiceName}
                        </div>
                      )}
                    </td>
                    <td>
                      <button
                        className={`${styles.btn} ${styles.btnOutline}`}
                        disabled={busy || !s.invoiceUrl}
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
          <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={sendAll}>
            Enviar todos
          </button>
        </div>
      </section>
    </main>
  );
}
