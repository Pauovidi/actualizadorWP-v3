'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';

import styles from './page.module.css';

type Site = {
  name: string;
  url: string;         // normalizada
  token?: string;
  email?: string;      // email destino (por sitio)
  billingFrequency?: 'monthly' | 'quarterly';
  quarterlyMonths?: number[] | null;
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
  correlationId?: string;
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
  const [hydrated, setHydrated] = useState(false);
  const [invoiceMap, setInvoiceMap] = useState<Record<string, { file_name: string; blob_url: string }>>({});
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(() => new Set());

  const currentPeriod = useMemo(() => dayjs().format('YYYY-MM'), []);
  const currentMonth = useMemo(() => Number(dayjs().format('M')), []);

  const refreshInvoices = useCallback(async (emailList?: string[]) => {
    try {
      const r = await fetch(`/api/invoices?period=${encodeURIComponent(currentPeriod)}`);
      const j = await r.json();
      if (j?.ok && Array.isArray(j.invoices)) {
        const map: Record<string, { file_name: string; blob_url: string }> = {};
        for (const inv of j.invoices) {
          const key = String(inv.billing_email || '').toLowerCase();
          if (!key) continue;
          map[key] = {
            file_name: inv.file_name,
            blob_url: inv.blob_url,
          };
        }
        setInvoiceMap(map);
      } else {
        setInvoiceMap({});
      }
    } catch {
      // ignore
    }
  }, [currentPeriod]);

  const saveSitesToServer = useCallback(async (nextSites: Site[]) => {
    try {
      // Usamos POST por compatibilidad (algunos despliegues devolvían 405 en PUT)
      // y replace=1 para que las eliminaciones en UI se reflejen en BD.
      // IMPORTANTE: si la lista está vacía, no hacemos replace para evitar borrados accidentales.
      const qs = nextSites.length > 0 ? '?replace=1' : '';
      await fetch(`/api/sites${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sites: nextSites.map((s) => ({
            name: s.name,
            url: s.url,
            token: s.token || '',
            email: s.email || '',
            billingFrequency: (s as any).billingFrequency || 'monthly',
            quarterlyMonths: (s as any).quarterlyMonths || null,
          })),
        }),
      });
    } catch {}
  }, []);


  // carga inicial desde servidor (fallback: localStorage)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/sites', { cache: 'no-store' });
        const j = await r.json();
        if (j?.ok && Array.isArray(j.sites)) {
          setSites(j.sites);
          setHydrated(true);
          await refreshInvoices();
          return;
        }
      } catch {}

      // fallback localStorage (solo si el servidor aún no tiene sitios)
      const raw =
        localStorage.getItem('awp_sites_v33') ||
        localStorage.getItem('awp_sites_v32');

      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setSites(parsed);
            // Migración automática: subimos al servidor para habilitar automatización
            await saveSitesToServer(parsed);
          }
        } catch {}
      }
      setHydrated(true);
      await refreshInvoices();
        })();
  }, [refreshInvoices, saveSitesToServer]);

  // autosave con debounce (servidor)
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      // Si el frontend se ha quedado temporalmente sin sites por un bug, evitamos enviar []
      // (en servidor también está protegido, pero así reducimos ruido).
      if (sites.length > 0) saveSitesToServer(sites);
    }, 800);
    return () => clearTimeout(t);
  }, [sites, hydrated, saveSitesToServer]);

  const today = useMemo(() => dayjs().format('DD/MM/YYYY'), []);

  const groupedEmails = useMemo(() => {
    const map = new Map<
      string,
      { email: string; count: number; billingFrequency: 'monthly' | 'quarterly'; quarterlyMonths: number[] | null }
    >();
    for (const s of sites) {
      const e = (s.email || '').trim().toLowerCase();
      if (!e) continue;
      const prev = map.get(e);
      const freq = (s.billingFrequency || 'monthly') as 'monthly' | 'quarterly';
      const qm = (s.quarterlyMonths || null) as number[] | null;
      if (!prev) {
        map.set(e, { email: e, count: 1, billingFrequency: freq, quarterlyMonths: qm });
      } else {
        map.set(e, {
          ...prev,
          count: prev.count + 1,
          // Si hay discrepancias entre sitios con el mismo email, gana el más "restrictivo".
          // (quarterly) y meses del primero no-null.
          billingFrequency: prev.billingFrequency === 'quarterly' || freq === 'quarterly' ? 'quarterly' : 'monthly',
          quarterlyMonths: prev.quarterlyMonths || qm,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
  }, [sites]);

  const updateBillingForEmail = (
    email: string,
    patch: { billingFrequency?: 'monthly' | 'quarterly'; quarterlyMonths?: number[] | null }
  ) => {
    setSites((current) =>
      current.map((s) => {
        const e = (s.email || '').trim().toLowerCase();
        if (e !== email) return s;
        return {
          ...s,
          billingFrequency: patch.billingFrequency ?? (s.billingFrequency || 'monthly'),
          quarterlyMonths:
            (patch.billingFrequency ?? s.billingFrequency) === 'quarterly'
              ? patch.quarterlyMonths ?? (s.quarterlyMonths || [3, 6, 9, 12])
              : null,
        };
      })
    );
  };

  const uploadInvoiceForEmail = async (email: string, file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('email', email);
      fd.append('period', currentPeriod);
      fd.append('file', file);

      const r = await fetch('/api/invoices/upload', { method: 'POST', body: fd });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || 'Error subiendo factura');
      await refreshInvoices();
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const setLastSendForEmail = (email: string, next: SendResult) => {
    const key = String(email || '').toLowerCase();
    setSites((current) =>
      current.map((s) => (String(s.email || '').toLowerCase() === key ? { ...s, lastSend: next } : s))
    );
  };

  const sendFailureMessage = (json: any) =>
    typeof json?.correlationId === 'string' && json.correlationId
      ? `No se pudo enviar el email. Referencia: ${json.correlationId}`
      : 'No se pudo enviar el email. Revisa los logs de producción.';

  const sendForEmail = async (email: string, invoiceDue: boolean) => {
    if (!email) return;

    // Recoge sites del cliente (mismo email)
    const key = String(email).toLowerCase();
    const clientSites = sites.filter((s) => String(s.email || '').toLowerCase() === key);

    if (clientSites.length === 0) {
      alert('No hay webs asociadas a este email');
      return;
    }

    // Recoge informes (deben existir tras actualizar)
    const reports: Array<{
      fileName: string;
      dataUrl: string;
      site: { name: string; url: string };
      status: UpdateResult['status'];
    }> = [];
    const errors: Array<{ site: { name: string; url: string }; error: string }> = [];

    for (const s of clientSites) {
      if (s.lastResult?.reportHtml) {
        reports.push({
          fileName: s.lastResult?.reportFileName || `informe-${s.name}.html`,
          dataUrl: s.lastResult.reportHtml,
          site: { name: s.name, url: normalizeUrl(s.url) },
          status: s.lastResult.status,
        });
      } else {
        const errMsg =
          (s.lastResult?.errors && s.lastResult.errors.join(' | ')) ||
          (s.lastResult?.status === 'ERROR' ? 'Error actualizando (sin informe)' : 'Informe no disponible. Ejecuta Actualizar antes.');
        errors.push({ site: { name: s.name, url: s.url }, error: errMsg });
      }
    }

    if (reports.length === 0) {
      alert('No hay informes para enviar. Ejecuta "Actualizar" antes.');
      return;
    }

    // Adjunta factura si existe en BD/Blob (y si toca, es obligatoria)
    const inv = invoiceMap[key];
    if (invoiceDue && !inv) {
      alert(`Falta factura (bloquea el envío) para ${email}`);
      return;
    }

    let invoicePayload: { fileName: string; base64: string } | null = null;
    if (inv) {
      const resp = await fetch(inv.blob_url);
      if (!resp.ok) {
        alert('No se ha podido descargar la factura desde Vercel Blob');
        return;
      }
      const ab = await resp.arrayBuffer();
      invoicePayload = { fileName: inv.file_name, base64: arrayBufferToBase64(ab) };
    }

    setBusy(true);
    try {
      const today = dayjs().format('YYYY-MM-DD');
      const subject = `Informe${invoicePayload ? ' y factura' : ''} — ${email} (${currentPeriod})`;
      const idempotencyKey = `group:${currentPeriod}:${email}:${reports
        .map((report) => report.fileName)
        .join('|')}:${invoicePayload?.fileName || 'no-invoice'}`;

      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          period: currentPeriod,
          sites: clientSites.map((s) => ({ name: s.name, url: s.url })),
          reports,
          invoice: invoicePayload,
          subject,
          idempotencyKey,
          errors: errors.length ? errors : undefined,
        }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(sendFailureMessage(json));

      setLastSendForEmail(email, { status: 'OK', via: json.via, correlationId: json.correlationId, at: today });
      alert(`Email enviado (${json.via || 'ok'}) a ${email}${json.correlationId ? ` · ${json.correlationId}` : ''}`);
    } catch (e: any) {
      setLastSendForEmail(email, { status: 'ERROR', error: e?.message || String(e), at: dayjs().format('YYYY-MM-DD') });
      alert(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

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

  const removeSite = (i: number) => {
    setSelectedIdx((prev) => {
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx === i) continue;
        next.add(idx > i ? idx - 1 : idx);
      }
      return next;
    });

    setSites((current) => {
      const target = current[i];
      if (target?.invoiceUrl) {
        URL.revokeObjectURL(target.invoiceUrl);
      }
      return current.filter((_, idx) => idx !== i);
    });
  };

  const updateSite = (i: number, patch: Partial<Site>) =>
    setSites(s => s.map((site, idx) => (idx === i ? { ...site, ...patch } : site)));

  const normalizeUrl = (raw: string) => {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    return `https://${trimmed.replace(/^www\./i, '')}`;
  };

  const toggleSelect = (i: number) => {
    setSelectedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const setAllSelected = (checked: boolean) => {
    setSelectedIdx(() => {
      if (!checked) return new Set();
      const next = new Set<number>();
      for (let i = 0; i < sites.length; i++) next.add(i);
      return next;
    });
  };

  const selectedCount = selectedIdx.size;
  const allSelected = sites.length > 0 && selectedCount === sites.length;


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
      const idempotencyKey = `single:${today}:${site.email || ''}:${site.url}:${site.lastResult?.reportFileName || 'no-report'}:${site.invoiceName || 'factura.pdf'}`;

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
          idempotencyKey,
        }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(sendFailureMessage(json));
      updateSite(i, {
        lastSend: {
          status: 'OK',
          via: json.via,
          correlationId: json.correlationId,
          at: new Date().toISOString(),
        },
      });
      alert(`Enviado ${site.name}: OK${json.correlationId ? ` · ${json.correlationId}` : ''}`);
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

      {/* Facturas (por cliente/email) */}
      <section className={`${styles.card} ${styles.cardStack}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className={styles.sectionTitle}>Facturas ({currentPeriod})</h2>
            <p className={styles.muted}>
              Sube <b>1 PDF por email</b> (cliente). Se guarda en Vercel Blob para que el cron mensual pueda adjuntarla automáticamente.
            </p>
          </div>
          <button
            className={styles.btnSecondary}
            onClick={() => refreshInvoices()}
            disabled={busy}
            type="button"
          >
            Refrescar estado
          </button>
        </div>

        {groupedEmails.length === 0 ? (
          <p className={styles.muted}>No hay emails todavía. Añade webs en el listado de abajo.</p>
        ) : (
          <div className={styles.invoiceGrid}>
            {groupedEmails.map(({ email, count, billingFrequency, quarterlyMonths }) => {
              const inv = invoiceMap[email];
              const months = quarterlyMonths && quarterlyMonths.length ? quarterlyMonths : [3, 6, 9, 12];
              const invoiceDue = billingFrequency === 'monthly' ? true : months.includes(currentMonth);
              const invoiceLabel =
                billingFrequency === 'monthly'
                  ? 'Factura requerida cada mes'
                  : invoiceDue
                  ? 'Este mes toca factura'
                  : 'Este mes NO toca factura';
              return (
                <div key={email} className={styles.invoiceRow}>
                  <div className={styles.invoiceMeta}>
                    <div className={styles.invoiceEmail}>{email}</div>
                    <div className={styles.invoiceHint}>{count} web(s)</div>
                    <div className={styles.invoiceControls}>
                      <label className={styles.inlineLabel}>
                        <span className={styles.inlineLabelText}>Frecuencia</span>
                        <select
                          className={styles.select}
                          value={billingFrequency}
                          onChange={(e) =>
                            updateBillingForEmail(email, {
                              billingFrequency: e.target.value as 'monthly' | 'quarterly',
                              quarterlyMonths: months,
                            })
                          }
                          disabled={busy}
                        >
                          <option value="monthly">Mensual</option>
                          <option value="quarterly">Trimestral (4 meses)</option>
                        </select>
                      </label>

                      {billingFrequency === 'quarterly' && (
                        <div className={styles.monthPicker}>
                          <div className={styles.monthPickerTitle}>Meses con factura</div>
                          <div className={styles.monthGrid}>
                            {Array.from({ length: 12 }).map((_, idx) => {
                              const m = idx + 1;
                              const checked = months.includes(m);
                              return (
                                <label key={m} className={styles.monthChip}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? Array.from(new Set([...months, m])).sort((a, b) => a - b)
                                        : months.filter((x) => x !== m);
                                      updateBillingForEmail(email, { quarterlyMonths: next });
                                    }}
                                    disabled={busy}
                                  />
                                  <span>{m}</span>
                                </label>
                              );
                            })}
                          </div>
                          <div className={styles.monthPickerHint}>
                            Marca los <b>4 meses</b> en los que este cliente debe recibir factura.
                          </div>
                        </div>
                      )}
                    </div>

                    <div className={styles.invoiceStatus}>
                      {inv ? (
                        <>
                          <span className={styles.okDot} /> <span>{inv.file_name}</span>
                        </>
                      ) : (
                        <>
                          <span className={styles.missingDot} />
                          <span>
                            {invoiceDue ? 'Falta factura (bloquea el envío)' : 'Sin factura (ok, no toca)'}
                          </span>
                        </>
                      )}
                    </div>
                    <div className={styles.invoiceRule}>{invoiceLabel}</div>
                  </div>
                  <label
                    className={`${styles.fileLabel} ${!invoiceDue ? styles.fileLabelDisabled : ''}`}
                    onDragOver={(e) => {
                      if (!invoiceDue || busy) return;
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (!invoiceDue || busy) return;
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f) uploadInvoiceForEmail(email, f);
                    }}
                  >
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadInvoiceForEmail(email, f);
                        e.currentTarget.value = '';
                      }}
                      disabled={busy || !invoiceDue}
                    />
                    <span className={styles.fileLabelBtn}>
                      {invoiceDue ? 'Subir / arrastrar PDF' : 'No toca este mes'}
                    </span>
                  </label>
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    type="button"
                    onClick={() => sendForEmail(email, invoiceDue)}
                    disabled={busy || (invoiceDue && !inv)}
                    title={invoiceDue && !inv ? 'Falta factura (bloquea el envío)' : 'Enviar email manual (para pruebas)'}
                    style={{ marginLeft: 12 }}
                  >
                    Enviar email
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Editor de sitios */}
      <section className={`${styles.card} ${styles.cardStack}`}>
        <div className={styles.gridHeader}>
          <div className={styles.selectCell}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={allSelected}
              onChange={(e) => setAllSelected(e.target.checked)}
              aria-label="Seleccionar todos"
            />
          </div>
          <div>Nombre</div>
          <div>URL</div>
          <div>Token</div>
          <div>Email destino</div>
        </div>

        {sites.map((s, i) => (
          <div className={styles.siteRow} key={i}>
            <div className={styles.selectCell}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={selectedIdx.has(i)}
                onChange={() => toggleSelect(i)}
                aria-label={`Seleccionar ${s.name}`}
              />
            </div>

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
            className={`${styles.btn} ${styles.btnSecondary}`}
            disabled={busy || selectedCount === 0}
            onClick={async () => {
              setBusy(true);
              for (let idx = 0; idx < sites.length; idx++) {
                if (!selectedIdx.has(idx)) continue;
                // eslint-disable-next-line no-await-in-loop
                await doUpdate(idx, false);
              }
              setBusy(false);
            }}
          >
            {busy ? 'Actualizando…' : `Actualizar seleccionadas (${selectedCount})`}
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
                {/* En esta versión, la factura se gestiona ARRIBA por email (cliente).
                    Evitamos duplicidad y que el layout se rompa cuando hay errores largos. */}
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
