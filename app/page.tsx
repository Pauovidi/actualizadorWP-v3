'use client';

import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import dayjs from 'dayjs';

import styles from './page.module.css';

type Site = {
  name: string;
  url: string;         // normalizada
  token?: string;
  email?: string;      // email destino (por sitio)
  destEmail?: string;  // compatibilidad con versiones anteriores
  invoiceFileName?: string | null;
  invoiceFileBase64?: string | null;
  lastResult?: UpdateResult | null;
  lastSend?: SendResult | null;
};

type UpdateResult = {
  status: 'OK' | 'ERROR' | 'WARN';
  errors?: string[];
  reportUrl?: string;
  reportFileName?: string;     // sugerencia de nombre
  at: string;                  // ISO date
};

type SendResult = {
  status: 'OK' | 'ERROR';
  via?: string;
  error?: string;
  at: string;
};

const DEMO =
  process.env.NEXT_PUBLIC_MODE === 'demo' ||
  process.env.NEXT_PUBLIC_DEMO === '1';

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const globalBuffer = (globalThis as unknown as {
    Buffer?: {
      from(data: ArrayBuffer | string, encoding?: string): {
        toString(encoding: string): string;
      };
    };
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
    if (raw) {
      const parsed: Site[] = JSON.parse(raw);
      setSites(
        parsed.map((site) => ({
          ...site,
          invoiceFileName: site.invoiceFileName ?? null,
          invoiceFileBase64: site.invoiceFileBase64 ?? null,
        }))
      );
    }
  }, []);
  useEffect(() => {
    localStorage.setItem('awp_sites_v33', JSON.stringify(sites));
  }, [sites]);

  const addSite = () =>
    setSites(s => [
      ...s,
      {
        name: 'Nuevo',
        url: 'https://',
        token: DEMO ? `demo-${Math.random().toString(36).slice(2, 8)}` : '',
        email: '',
        invoiceFileName: null,
        invoiceFileBase64: null,
      },
    ]);

  const removeSite = (i: number) =>
    setSites((current) => current.filter((_, idx) => idx !== i));

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sites: [
            {
              name: site.name,
              url: normalizeUrl(site.url),
              token: site.token ?? '',
              email: site.email ?? '',
            },
          ],
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
            reportUrl: undefined,
            reportFileName: undefined,
            at: new Date().toISOString(),
          },
        });
        alert(`Actualizado ${site.name}: con incidencias ("${errorMessage}")`);
        return;
      }

      const results = Array.isArray(json?.results) ? json.results : null;
      if (results?.length) {
        const result = results[0] ?? {};
        const rawStatus = String(result?.status || '').toLowerCase();
        let normalizedStatus: UpdateResult['status'] = 'WARN';
        if (rawStatus === 'ok') normalizedStatus = 'OK';
        else if (rawStatus === 'ok_with_notes' || rawStatus === 'warn') normalizedStatus = 'WARN';
        else if (rawStatus === 'error' || rawStatus === 'err') normalizedStatus = 'ERROR';

        const errorsList: string[] = [];
        if (Array.isArray(result?.errors)) {
          errorsList.push(...result.errors.map((err: unknown) => String(err)));
        } else if (typeof result?.errors === 'number' && result.errors > 0) {
          errorsList.push(`Errores detectados: ${result.errors}`);
        } else if (result?.errors) {
          errorsList.push(String(result.errors));
        }
        if (result?.message) {
          errorsList.push(String(result.message));
        }

        const reportUrl: string | undefined =
          typeof result?.reportUrl === 'string' ? result.reportUrl : undefined;
        const reportFileName = reportUrl?.split('/').pop();

        updateSite(i, {
          lastResult: {
            status: normalizedStatus,
            errors: errorsList,
            reportUrl,
            reportFileName: reportFileName || 'informe-demo.html',
            at: new Date().toISOString(),
          },
        });
        alert(`Actualizado ${site.name}: ${normalizedStatus}`);
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

      let reportLink: string | undefined =
        typeof payload?.reportUrl === 'string' ? payload.reportUrl : undefined;
      if (!reportLink && typeof reportHtmlRaw === 'string') {
        if (reportHtmlRaw.startsWith('data:')) {
          reportLink = reportHtmlRaw;
        } else if (/[<>]/.test(reportHtmlRaw)) {
          try {
            if (typeof TextEncoder !== 'undefined') {
              const buffer = new TextEncoder().encode(reportHtmlRaw).buffer;
              reportLink = `data:text/html;base64,${arrayBufferToBase64(buffer)}`;
            } else {
              const globalBuffer = (globalThis as unknown as {
                Buffer?: {
                  from(data: string, encoding?: string): {
                    toString(encoding: string): string;
                  };
                };
              }).Buffer;
              if (globalBuffer?.from) {
                reportLink = `data:text/html;base64,${globalBuffer
                  .from(reportHtmlRaw, 'utf-8')
                  .toString('base64')}`;
              }
            }
          } catch {
            reportLink = undefined;
          }
        } else {
          reportLink = `data:text/html;base64,${reportHtmlRaw}`;
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
          reportUrl: reportLink,
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
          reportUrl: undefined,
          reportFileName: undefined,
          at: new Date().toISOString(),
        },
      });
      alert(`Error actualizando ${site.name}: ${String(e)}`);
    } finally {
      if (manageBusy) setBusy(false);
    }
  };

  const onPickInvoice = (idx: number) => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSites((current) =>
        current.map((site, i) =>
          i === idx
            ? {
                ...site,
                invoiceFileName: null,
                invoiceFileBase64: null,
                lastSend: null,
              }
            : site
        )
      );
      e.target.value = '';
      return;
    }

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const [, content] = result.split(',');
        resolve(content || '');
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    setSites((current) =>
      current.map((site, i) =>
        i === idx
          ? {
              ...site,
              invoiceFileName: file.name,
              invoiceFileBase64: base64,
              lastSend: null,
            }
          : site
      )
    );
    e.target.value = '';
  };

  const renderReport = (r?: UpdateResult | null) => {
    const url = typeof r?.reportUrl === 'string' ? r.reportUrl : null;
    if (!url) {
      return <span className={styles.muted}>—</span>;
    }

    return (
      <a
        className="ui-chip"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        Ver informe
      </a>
    );
  };

  const sendEmail = async (row: Site, index: number, manageBusy = true) => {
    const siteName = row.name || 'sitio';
    const to = (row.email || row.destEmail || '').trim();
    if (!to) {
      alert("Falta 'Email destino'");
      return;
    }

    const reportUrl =
      typeof row.lastResult?.reportUrl === 'string'
        ? row.lastResult.reportUrl
        : null;

    try {
      if (manageBusy) setBusy(true);
      updateSite(index, { lastSend: null });

      const attachments = row.invoiceFileBase64
        ? [
            {
              filename: row.invoiceFileName || 'factura.pdf',
              contentBase64: row.invoiceFileBase64,
              contentType: 'application/pdf',
            },
          ]
        : [];

      if (row.invoiceFileBase64 && !row.invoiceFileBase64.length) {
        throw new Error('La factura seleccionada está vacía o no se pudo leer.');
      }

      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject: `Informe ${siteName}`,
          html:
            'Hola. <br>Adjunto el informe de actualización de tu web, así como la fca. correspondiente a este mes. <br>Un saludo.',
          reportUrl,
          attachments,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `${res.status} ${res.statusText}`);
      }

      const via = data?.id ? `SMTP · ${data.id}` : 'SMTP';
      updateSite(index, {
        lastSend: {
          status: 'OK',
          via,
          at: new Date().toISOString(),
        },
      });
      alert(`Enviado ${siteName}: OK`);
    } catch (e: any) {
      updateSite(index, {
        lastSend: {
          status: 'ERROR',
          error: String(e?.message || e),
          at: new Date().toISOString(),
        },
      });
      alert(`Error enviando ${siteName}: "${String(e?.message || e)}"`);
    } finally {
      if (manageBusy) setBusy(false);
    }
  };

  const sendAll = async () => {
    setBusy(true);
    for (let i = 0; i < sites.length; i++) {
      const row = sites[i];
      if (!row) continue;
      const to = (row.email || row.destEmail || '').trim();
      if (!to) {
        alert(`Falta 'Email destino' en ${row.name || `sitio ${i + 1}`}`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await sendEmail(row, i, false);
    }
    setBusy(false);
  };

  return (
    <main className="main">
      <header className="topbar">
        <h1 className="title">Panel Actualizador WP</h1>
      </header>

      {/* Editor de sitios */}
      <section className="card card-stack">
        <div className="grid-header">
          <div>Nombre</div>
          <div>URL</div>
          <div>Token</div>
          <div>Email destino</div>
        </div>

        {sites.map((s, i) => (
          <div className="site-row" key={i}>
            <input
              className="input"
              value={s.name}
              onChange={(e) => updateSite(i, { name: e.target.value })}
            />
            <input
              className="input"
              value={s.url}
              onChange={(e) => updateSite(i, { url: e.target.value })}
            />
            <input
              className="input"
              value={s.token ?? ''}
              onChange={(e) => updateSite(i, { token: e.target.value })}
            />
            <div className="email-cell">
              <input
                type="email"
                className={`input ${!s.email ? 'input-error' : ''}`}
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

        <div className="card-actions">
          <button className="btn btn-ghost" onClick={addSite}>
            Añadir sitio
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => sites.forEach((_, idx) => doUpdate(idx))}>
            {busy ? 'Actualizando…' : 'Actualizar Todo'}
          </button>
        </div>
      </section>

      {/* Resultados */}
      <section className="card card-stack">
        <h2 className="section-title">Resultados</h2>

        <div className="results-wrapper">
          <table className="results-table table">
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
                    <td>{renderReport(r)}</td>
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
                      <div className={styles.invoiceCell}>
                        <label className={`${styles.btn} ${styles.btnGhost}`}>
                          Cargar factura PDF
                          <input
                            className={styles.fileInput}
                            type="file"
                            accept="application/pdf"
                            onChange={onPickInvoice(i)}
                          />
                        </label>
                        <p className={styles.fileName}>
                          {s.invoiceFileName ? (
                            s.invoiceFileName
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
                        onClick={() => sendEmail(s, i)}
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

        <div className="card-actions card-actions--end">
          <button className="btn btn-primary" onClick={sendAll}>Enviar todos</button>
        </div>
      </section>
    </main>
  );
}
