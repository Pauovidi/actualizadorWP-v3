'use client';

import React, { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import styles from './page.module.css';

type LastResult = {
  status: 'OK' | 'WARN' | 'ERROR' | string;
  errors?: string[];
  reportUrl?: string;
  reportFileName?: string;
  at?: string;
  message?: string;
} | null;

type LastSend = {
  status: 'OK' | 'ERROR';
  via?: string;
  error?: string;
  at: string;
} | null;

type SiteRow = {
  name: string;
  url: string;
  token?: string;
  email?: string;
  invoiceFileName: string | null;
  invoiceFileBase64: string | null;
  lastResult?: LastResult;
  lastSend?: LastSend;
};

const LS_KEY = 'awp_sites_v33';

function bufToBase64(arrbuf: ArrayBuffer) {
  const g = (globalThis as any);
  const Buf = g?.Buffer;
  if (Buf?.from) return Buf.from(arrbuf).toString('base64');
  let bin = '';
  const bytes = new Uint8Array(arrbuf);
  for (let i = 0; i < bytes.length; i += 32768) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  if (typeof btoa === 'function') return btoa(bin);
  throw new Error('No hay codificador base64 disponible en este entorno');
}

function normalizeUrl(u?: string) {
  if (!u) return '';
  const t = u.trim();
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  return `https://${t.replace(/^www\./i, '')}`;
}

export default function Page() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [busy, setBusy] = useState(false);

  // Cargar de localStorage
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY) || localStorage.getItem('awp_sites_v32');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as SiteRow[];
      setSites(
        parsed.map((s) => ({
          ...s,
          invoiceFileName: s.invoiceFileName ?? null,
          invoiceFileBase64: s.invoiceFileBase64 ?? null,
        }))
      );
    } catch {}
  }, []);

  // Guardar en localStorage
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(sites));
  }, [sites]);

  const removeRow = (idx: number) =>
    setSites((prev) => prev.filter((_, i) => i !== idx));

  const patchRow = (idx: number, patch: Partial<SiteRow>) =>
    setSites((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  // === Genera el botón/acción "Informe" con manejo para data: ===
  const renderReportChip = (res: LastResult | undefined) => {
    const t = typeof res?.reportUrl === 'string' ? res!.reportUrl : null;
    const file = res?.reportFileName || 'informe.html';

    if (!t) return <span className={styles.muted}>—</span>;

    const isData = t.startsWith('data:text/html');
    return isData ? (
      <a className="ui-chip" href={t} download={file}>
        Descargar informe
      </a>
    ) : (
      <a className="ui-chip" href={t} target="_blank" rel="noopener">
        Ver informe
      </a>
    );
  };

  // === Acción: Actualizar 1 sitio ===
  const runUpdate = async (idx: number, showSpinner = true) => {
    const row = sites[idx];
    if (!row?.url) return;
    try {
      if (showSpinner) setBusy(true);
      patchRow(idx, { lastResult: null });
      const resp = await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sites: [
            {
              name: row.name,
              url: normalizeUrl(row.url),
              token: row.token ?? '',
              email: row.email ?? '',
            },
          ],
        }),
      });

      let json: any = null;
      try {
        json = await resp.json();
      } catch {
        json = null;
      }

      if (!resp.ok || !json?.ok) {
        const errMsg = json?.error || `${resp.status} ${resp.statusText}`;
        patchRow(idx, {
          lastResult: {
            status: 'ERROR',
            errors: [errMsg],
            at: new Date().toISOString(),
          },
        });
        alert(`Actualizado ${row.name}: con incidencias ("${errMsg}")`);
        return;
      }

      // results[] del backend con reportUrl listo
      const arr = Array.isArray(json?.results) ? json.results : null;
      if (arr?.length) {
        const r0 = arr[0] ?? {};
        // Normaliza status a “OK | WARN | ERROR”
        const s = String(r0.status ?? '').toLowerCase();
        let norm: 'OK' | 'WARN' | 'ERROR' = 'WARN';
        if (s === 'ok') norm = 'OK';
        else if (s === 'error' || s === 'err') norm = 'ERROR';
        else if (s === 'warn' || s === 'ok_with_notes') norm = 'WARN';

        const errs = Array.isArray(r0.errors)
          ? r0.errors.map((x: any) => String(x))
          : r0.errors
          ? [String(r0.errors)]
          : [];

        const reportUrl: string | undefined =
          typeof r0.reportUrl === 'string' ? r0.reportUrl : undefined;

        const reportFileName: string | undefined =
          typeof r0.reportFileName === 'string'
            ? r0.reportFileName
            : `informe-${new Date().toISOString().slice(0, 10)}.html`;

        patchRow(idx, {
          lastResult: {
            status: norm,
            errors: errs,
            reportUrl,
            reportFileName,
            at: new Date().toISOString(),
            message: r0.message,
          },
        });
        alert(`Actualizado ${row.name}: ${norm}`);
        return;
      }

      // Soporte “legacy” (si el backend devolviera {data:{...}})
      const data = json?.data;
      const g = data?.errors;
      const errs = Array.isArray(g) ? g.map((x: any) => String(x)) : g ? [String(g)] : [];
      let reportUrl: string | undefined =
        typeof data?.reportUrl === 'string' ? data.reportUrl : undefined;

      // Fallback: si vino el HTML en claro, convertirlo a data URL
      const possibleHtml =
        data?.reportHtml ||
        data?.htmlReport ||
        data?.report?.html ||
        data?.report?.base64 ||
        data?.report;

      if (!reportUrl && typeof possibleHtml === 'string') {
        if (possibleHtml.startsWith('data:')) {
          reportUrl = possibleHtml;
        } else if (/[<>]/.test(possibleHtml)) {
          try {
            if (typeof TextEncoder !== 'undefined') {
              const ab = new TextEncoder().encode(possibleHtml).buffer;
              reportUrl = `data:text/html;base64,${bufToBase64(ab)}`;
            }
          } catch {}
        } else {
          reportUrl = `data:text/html;base64,${possibleHtml}`;
        }
      }

      const reportFileName =
        data?.reportFileName || data?.report?.fileName || `informe-${new Date().toISOString().slice(0, 10)}.html`;

      patchRow(idx, {
        lastResult: {
          status: (data?.status ?? 'OK') as any,
          errors: errs,
          reportUrl,
          reportFileName,
          at: new Date().toISOString(),
        },
      });
      alert(`Actualizado ${row.name}: ${data?.status ?? 'OK'}`);
    } catch (e: any) {
      patchRow(idx, {
        lastResult: {
          status: 'ERROR',
          errors: [String(e?.message ?? e)],
          at: new Date().toISOString(),
        },
      });
      alert(`Error actualizando ${row.name}: ${String(e?.message ?? e)}`);
    } finally {
      if (showSpinner) setBusy(false);
    }
  };

  // Cargar factura PDF
  const onInvoiceChange =
    (idx: number) =>
    async (ev: React.ChangeEvent<HTMLInputElement>) => {
      const file = ev.target.files?.[0];
      if (!file) {
        setSites((prev) =>
          prev.map((row, i) =>
            i === idx
              ? { ...row, invoiceFileName: null, invoiceFileBase64: null, lastSend: null }
              : row
          )
        );
        ev.target.value = '';
        return;
      }
      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
          const val = typeof fr.result === 'string' ? fr.result : '';
          const [, b64] = val.split(',');
          resolve(b64 || '');
        };
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });

      setSites((prev) =>
        prev.map((row, i) =>
          i === idx
            ? {
                ...row,
                invoiceFileName: file.name,
                invoiceFileBase64: base64,
                lastSend: null,
              }
            : row
        )
      );
      ev.target.value = '';
    };

  // Enviar email con informe + factura
  const sendEmail = async (row: SiteRow, idx: number, showSpinner = true) => {
    const siteName = row.name || 'sitio';
    const to = (row.email || '').trim();
    if (!to) {
      alert(`Falta 'Email destino'`);
      return;
    }
    const reportUrl =
      typeof row.lastResult?.reportUrl === 'string' ? row.lastResult.reportUrl : null;

    try {
      if (showSpinner) setBusy(true);
      patchRow(idx, { lastSend: null });

      const atts =
        row.invoiceFileBase64 && row.invoiceFileBase64.length
          ? [
              {
                filename: row.invoiceFileName || 'factura.pdf',
                contentBase64: row.invoiceFileBase64,
                contentType: 'application/pdf',
              },
            ]
          : [];

      const resp = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject: `Informe ${siteName}`,
          html:
            'Hola.<br>Adjunto el informe de actualización de tu web, así como la fca. correspondiente a este mes.<br>Un saludo.',
          reportUrl,
          attachments: atts,
        }),
      });

      const out = await resp.json().catch(() => null);
      if (!resp.ok || !out?.ok) {
        throw new Error(out?.error || `${resp.status} ${resp.statusText}`);
      }

      const via = out?.id ? `SMTP · ${out.id}` : 'SMTP';
      patchRow(idx, {
        lastSend: { status: 'OK', via, at: new Date().toISOString() },
      });
      alert(`Enviado ${siteName}: OK`);
    } catch (e: any) {
      patchRow(idx, {
        lastSend: {
          status: 'ERROR',
          error: String(e?.message ?? e),
          at: new Date().toISOString(),
        },
      });
      alert(`Error enviando ${siteName}: "${String(e?.message ?? e)}"`);
    } finally {
      if (showSpinner) setBusy(false);
    }
  };

  // Enviar todos (solo email)
  const sendAll = async () => {
    setBusy(true);
    for (let i = 0; i < sites.length; i++) {
      const row = sites[i];
      if (!row) continue;
      const dest = (row.email || '').trim();
      if (!dest) {
        alert(`Falta 'Email destino' en ${row.name || `sitio ${i + 1}`}`);
        continue;
      }
      await sendEmail(row, i, false);
    }
    setBusy(false);
  };

  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <h1 className={styles.title}>Panel Actualizador WP</h1>
      </header>

      {/* Sitios */}
      <section className={`${styles.card} ${styles.cardStack}`}>
        <div className={styles.gridHeader}>
          <div>Nombre</div>
          <div>URL</div>
          <div>Token</div>
          <div>Email destino</div>
        </div>

        {sites.map((row, idx) => {
          return (
            <div className={styles.siteRow} key={idx}>
              <input
                className={styles.input}
                value={row.name}
                onChange={(e) => patchRow(idx, { name: e.target.value })}
              />
              <input
                className={styles.input}
                value={row.url}
                onChange={(e) => patchRow(idx, { url: e.target.value })}
              />
              <input
                className={styles.input}
                value={row.token ?? ''}
                onChange={(e) => patchRow(idx, { token: e.target.value })}
              />
              <div className={styles.emailCell}>
                <input
                  type="email"
                  className={`${styles.input} ${row.email ? '' : styles.inputError}`}
                  placeholder="cliente@dominio.com"
                  value={row.email ?? ''}
                  onChange={(e) => patchRow(idx, { email: e.target.value })}
                />
                <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => removeRow(idx)}>
                  Eliminar
                </button>
              </div>
            </div>
          );
        })}

        <div className={styles.cardActions}>
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() =>
              setSites((prev) => [
                ...prev,
                {
                  name: 'Nuevo',
                  url: 'https://',
                  token: '',
                  email: '',
                  invoiceFileName: null,
                  invoiceFileBase64: null,
                },
              ])
            }
          >
            Añadir sitio
          </button>

          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={busy}
            onClick={() => sites.forEach((_, i) => runUpdate(i))}
          >
            {busy ? 'Actualizando…' : 'Actualizar Todo'}
          </button>
        </div>
      </section>

      {/* Resultados */}
      <section className={`${styles.card} ${styles.cardStack}`}>
        <h2 className={styles.sectionTitle}>Resultados</h2>

        <div className={styles.resultsWrapper}>
          <table className={`${styles.resultsTable} table`}>
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
              {sites.map((row, idx) => {
                const r = row.lastResult;
                return (
                  <tr key={idx}>
                    <td>{row.name}</td>

                    <td>
                      {r ? (
                        <div className={styles.statusTag} data-status={r.status}>
                          {r.status}
                        </div>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                      {r?.at && <span className={styles.timestamp}>{dayjs(r.at).format('HH:mm')}</span>}
                    </td>

                    <td className={styles.alignLeft}>
                      {r?.errors?.length ? (
                        <ul className={styles.errorList}>
                          {r.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>

                    <td>{renderReportChip(r)}</td>

                    <td className={styles.alignLeft}>
                      {row.lastSend ? (
                        <div className={styles.sendStatus} data-status={row.lastSend.status}>
                          <span>
                            {row.lastSend.status === 'OK'
                              ? `OK${row.lastSend.via ? ` · ${row.lastSend.via}` : ''}`
                              : 'ERROR'}
                          </span>
                          {row.lastSend.error && <p>{row.lastSend.error}</p>}
                          <time>{dayjs(row.lastSend.at).format('HH:mm')}</time>
                        </div>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>

                    <td className={styles.alignLeft}>
                      <div className={styles.invoiceCell}>
                        <label className={`${styles.btn} ${styles.btnGhost}`}>
                          Cargar factura PDF
                          <input
                            className={styles.fileInput}
                            type="file"
                            accept="application/pdf"
                            onChange={onInvoiceChange(idx)}
                          />
                        </label>
                        <p className={styles.fileName}>
                          {row.invoiceFileName ? (
                            row.invoiceFileName
                          ) : (
                            <span className={styles.muted}>
                              <em>Ningún archivo seleccionado</em>
                            </span>
                          )}
                        </p>
                      </div>
                    </td>

                    <td>
                      <button
                        className={`${styles.btn} ${styles.btnOutline}`}
                        disabled={busy}
                        onClick={() => sendEmail(row, idx)}
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
          <button className={styles.btn + ' ' + styles.btnPrimary} onClick={sendAll}>
            Enviar todos
          </button>
        </div>
      </section>
    </main>
  );
}
