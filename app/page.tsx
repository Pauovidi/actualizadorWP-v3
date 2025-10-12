"use client";
import { useEffect, useState } from "react";
import type { SiteInput, ApiUpdateResponse } from "@/lib/types";

const LS_KEY = "awp.sites.v1";
const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

// Base64 seguro para UTF-8 (sin unescape)
function utf8ToB64(str: string){
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i=0; i<bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Normaliza lo que escriba el usuario: "dominio.com" → "https://dominio.com"
// Respeta si pone "www.dominio.com"
function normalizeUrlLoose(v: string): string {
  let s = (v || "").trim();
  if (!s) return "";
  s = s
    .replace(/^https?:\/\//i, "")
    .replace(/^\/\//, "")
    .split("/")[0]        // solo host
    .replace(/:\d+$/, ""); // sin puerto
  return `https://${s.toLowerCase()}`;
}

function formatDateDDMMYYYY(d: Date){
  const p = (n:number)=> (n<10?`0${n}`:`${n}`);
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()}`;
}

export default function Dashboard(){
  const [sites, setSites] = useState<SiteInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [jsonOut, setJsonOut] = useState<ApiUpdateResponse | null>(null);

  useEffect(() => {
    try{
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setSites(JSON.parse(raw));
    }catch{}
  }, []);

  useEffect(() => {
    try{
      // Guardamos sin los binarios de factura (ligero)
      const light = sites.map(({ invoiceB64, invoiceType, invoiceName, ...rest }) => rest as SiteInput);
      localStorage.setItem(LS_KEY, JSON.stringify(light));
    }catch{}
  }, [sites]);

  function addRow(){ setSites(prev => [...prev, { name:"", url:"", token:"" }]); }
  function delRow(i:number){ setSites(prev => prev.filter((_,idx)=> idx!==i)); }
  function updRow(i:number, patch: Partial<SiteInput>){
    setSites(prev => {
      const next = prev.map((s,idx)=> idx===i? {...s, ...patch}: s);
      if (DEMO && patch.url !== undefined) {
        const clean = (patch.url || "").replace(/\/$/, "");
        next[i].url = clean;
        if (!next[i].token) next[i].token = "demo-" + Math.random().toString(36).slice(2,8);
      }
      return next;
    });
  }

  async function runAll(){
    if (!sites.length) return;
    setBusy(true);
    try{
      const res = await fetch("/api/update", {
        method:"POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ sites })
      });
      const data = await res.json().catch(()=> ({}));
      setJsonOut(res.ok ? data : { error: data?.error ?? `HTTP ${res.status}`, sites: [] });
    }catch(err){
      setJsonOut({ error: String(err), sites: [] } as any);
    }finally{ setBusy(false); }
  }

  function downloadHtml(name: string, html: string){
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.html`; a.click();
    setTimeout(()=> URL.revokeObjectURL(url), 1000);
  }

  function onPickInvoice(i: number){
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/png,image/jpeg";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      setSites(prev => {
        const next = [...prev];
        next[i].invoiceName = file.name;
        next[i].invoiceType = file.type || "application/pdf";
        next[i].invoiceB64 = b64;
        return next;
      });
    };
    input.click();
  }

  async function sendOne(i: number, reportHtml?: string){
    const site = sites[i];
    if (!site.invoiceB64){
      alert(`Falta factura para ${site.name || "sitio " + (i+1)}. No se envía.`);
      return { ok:false, error:"Falta factura" };
    }

    // Datos del informe para el cuerpo/asunto
    const r = jsonOut?.sites?.[i];
    const okCount = r?.response?.updated?.length ?? 0;
    const errCount = r?.response?.errors?.length ?? 0;
    const startedAt = r?.response?.startedAt || "";
    const siteUrl = site.url || r?.site?.url || "";

    // Fecha para asunto: de startedAt si existe, si no hoy
    const datePart = startedAt.split(" ")[0] || formatDateDDMMYYYY(new Date());
    const subject = `Informe y factura — ${site.name} (${datePart})`;

    const htmlBody = `
      <p>Hola,</p>
      <p>Te envío el informe y la factura de <strong>${site.name || "tu sitio"}</strong>.</p>
      <ul>
        <li><strong>Web:</strong> <a href="${siteUrl}">${siteUrl}</a></li>
        <li><strong>Ejecutado:</strong> ${startedAt || datePart}</li>
        <li><strong>Acciones correctas (OK):</strong> ${okCount}</li>
        <li><strong>Errores:</strong> ${errCount}</li>
      </ul>
      <p>Adjuntos: informe HTML y factura.</p>
      <p>Un saludo,<br/>Actualitzador WP</p>
    `.trim();

    const attReport = {
      filename: `informe-${site.name}.html`,
      contentB64: utf8ToB64(reportHtml || ""),
      contentType: "text/html; charset=utf-8",
    };
    const attInvoice = {
      filename: site.invoiceName || "factura.pdf",
      contentB64: site.invoiceB64,
      contentType: site.invoiceType || "application/pdf",
    };

    const res = await fetch("/api/send", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        to: site.emailTo || undefined, // si no, usa EMAIL_TO_DEFAULT en backend
        subject,
        html: htmlBody,
        attachments: [attReport, attInvoice]
      })
    });
    const data = await res.json();
    if (!res.ok) alert(`Error enviando ${site.name}: ${JSON.stringify(data.error||data)}`);
    else alert(`Email enviado — ${site.name}`);
    return data;
  }

  async function sendAll(){
    if (!jsonOut?.sites?.length) return alert("No hay informes generados.");
    for (let i=0; i<jsonOut.sites.length; i++){
      const rep = jsonOut.sites[i]?.reportHtml || "";
      if (!sites[i]?.invoiceB64){
        alert(`Falta factura en ${sites[i]?.name || "fila "+(i+1)}. Ese no se envía.`);
        continue;
      }
      await sendOne(i, rep);
    }
  }

  return (
    <div className="container">
      <div className="topbar">
        <h1 style={{fontSize:28, fontWeight:800, marginBottom:12}}>Actualitzador WP — Dashboard</h1>
        <div className="right">{DEMO && <span className="demo">DEMO</span>}</div>
      </div>

      <div className="card" style={{marginTop:16}}>
        <div className="row" style={{fontWeight:700}}>
          <div>Nombre</div><div>URL</div><div>Token</div><div>Email destino</div><div></div>
        </div>
        {sites.map((s, i)=> (
          <div className="row" key={i}>
            <input className="input" placeholder="Devestial" value={s.name} onChange={e=>updRow(i,{name:e.target.value})} />
            <input
              className="input"
              placeholder="tu-dominio.com"
              value={s.url}
              onChange={e=>updRow(i,{url:e.target.value})}
              onBlur={()=>updRow(i,{url: normalizeUrlLoose(s.url)})}
            />
            <input className="input" placeholder="token" value={s.token} onChange={e=>updRow(i,{token:e.target.value})} />
            <input className="input" placeholder="cliente@empresa.com" value={s.emailTo||""} onChange={e=>updRow(i,{emailTo:e.target.value})} />
            <button className="btn" onClick={()=>delRow(i)}>Eliminar</button>
          </div>
        ))}
        <div style={{display:"flex", gap:10, marginTop:12}}>
          <button className="btn" onClick={addRow}>Añadir sitio</button>
          <button className="btn primary" onClick={runAll} disabled={busy}>{busy? "Actualizando…" : "Actualizar Todo"}</button>
        </div>
      </div>

      {jsonOut && (
        <div className="card" style={{marginTop:16}}>
          <h2 style={{marginTop:0}}>Resultados</h2>
          <table className="table">
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
              {jsonOut?.error && (
                <tr><td colSpan={6} className="small">Error: {typeof jsonOut.error === 'string' ? jsonOut.error : 'Payload inválido'}</td></tr>
              )}
              {Array.isArray(jsonOut?.sites) && jsonOut!.sites.length > 0 ? (
                jsonOut!.sites.map((r, idx)=> (
                  <tr key={idx}>
                    <td>{r.site?.name}</td>
                    <td>{r.ok ? 'OK' : 'ERROR'}</td>
                    <td>{r.response?.errors?.join(', ') || r.error || '-'}</td>
                    <td>
                      {r.reportHtml ? (
                        <button className="btn" onClick={()=>downloadHtml(r.site!.name, r.reportHtml!)}>Descargar HTML</button>
                      ) : <span className="small">—</span>}
                    </td>
                    <td>
                      <button className="btn" onClick={()=>onPickInvoice(idx)}>
                        {sites[idx]?.invoiceName ? `Cambiar (${sites[idx].invoiceName})` : "Cargar factura"}
                      </button>
                    </td>
                    <td>
                      <button className="btn" onClick={()=>sendOne(idx, r.reportHtml || "")}>Enviar email</button>
                    </td>
                  </tr>
                ))
              ) : (
                !jsonOut?.error && (
                  <tr><td colSpan={6} className="small">Sin resultados todavía.</td></tr>
                )
              )}
            </tbody>
          </table>

          <div className="footerRow">
            <button className="btn primary" onClick={sendAll}>Enviar todos</button>
          </div>
        </div>
      )}
    </div>
  );
}
