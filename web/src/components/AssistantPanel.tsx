// FLOW 6 v2 — "Chiedi ad Amimì": slide-in assistant panel, present on every screen.
// Read-only: calls the `assistant` edge (gated by ai_enabled). Self-gates — renders nothing when the flag is off.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { askAssistant, fetchOpsFlags, writeApi, type AsstResult, type AsstMsg, type AsstGrafico, type AsstProdotto, type AsstAzione } from '../lib/api';

type Turn = { user: string; res?: AsstResult };

const CHIPS = ['Cosa riordinare?', 'Le più vendute con foto', 'Borse a stock zero', 'Vendite di luglio'];

const nfmt = (v: number) => Number.isInteger(v) ? v.toLocaleString('it-IT') : v.toLocaleString('it-IT', { maximumFractionDigits: 2 });

function Spark({ s = 18 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.6 4.9L18.5 9.5 13.6 11 12 16l-1.6-5L5.5 9.5 10.4 7.9 12 3z" fill="currentColor" />
      <circle cx="18.5" cy="17.5" r="1.5" fill="currentColor" />
      <circle cx="6" cy="16.5" r="1.1" fill="currentColor" />
    </svg>
  );
}

// Lightweight, dependency-free charts. One series -> no legend, labels sit next to the data (dataviz rules).
function Chart({ g }: { g: AsstGrafico }) {
  const vals = g.valori.map((v) => Number(v) || 0);
  const max = Math.max(1, ...vals.map((v) => Math.abs(v)));
  if (g.tipo === 'torta') {
    const tot = vals.reduce((a, b) => a + Math.abs(b), 0) || 1;
    const cols = ['#9C5F33', '#C4956A', '#8B5E6B', '#B98A5E', '#6E3F4D', '#D2B48C', '#A8764A', '#7C5A45'];
    let acc = 0; const R = 52, C = 60;
    const seg = vals.map((v, i) => {
      const frac = Math.abs(v) / tot; const a0 = acc * 2 * Math.PI - Math.PI / 2; acc += frac; const a1 = acc * 2 * Math.PI - Math.PI / 2;
      const big = frac > 0.5 ? 1 : 0;
      return { d: `M${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)} A${R} ${R} 0 ${big} 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)} L${C} ${C} Z`, fill: cols[i % cols.length] };
    });
    return (
      <div className="ai-viz">
        {g.titolo && <div className="ai-viz-h">{g.titolo}</div>}
        <div className="ai-pie">
          <svg viewBox="0 0 120 120" width="120" height="120">
            {seg.map((s, i) => <path key={i} d={s.d} fill={s.fill} />)}
            <circle cx="60" cy="60" r="26" fill="var(--card)" />
          </svg>
          <div className="ai-legend">{g.etichette.map((l, i) => (
            <div key={i} className="ai-leg"><span className="ai-sw" style={{ background: cols[i % cols.length] }} />{l} <b>{nfmt(vals[i])}</b></div>
          ))}</div>
        </div>
      </div>
    );
  }
  if (g.tipo === 'linee') {
    const W = 300, H = 120, pad = 8; const n = vals.length;
    const x = (i: number) => pad + (n <= 1 ? 0 : (i * (W - 2 * pad)) / (n - 1));
    const y = (v: number) => H - pad - (Math.abs(v) / max) * (H - 2 * pad);
    const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    return (
      <div className="ai-viz">
        {g.titolo && <div className="ai-viz-h">{g.titolo}</div>}
        <svg viewBox={`0 0 ${W} ${H}`} className="ai-line" preserveAspectRatio="none">
          <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {vals.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="var(--accent)" />)}
        </svg>
        <div className="ai-xaxis">{g.etichette.map((l, i) => <span key={i}>{l}</span>)}</div>
      </div>
    );
  }
  // barre (default): horizontal bars
  return (
    <div className="ai-viz">
      {g.titolo && <div className="ai-viz-h">{g.titolo}</div>}
      {g.etichette.map((lab, i) => (
        <div className="ai-bar" key={i}>
          <div className="ai-bar-nm" title={lab}>{lab}</div>
          <div className="ai-bar-track"><div className="ai-bar-fill" style={{ width: `${(Math.abs(vals[i]) / max) * 100}%` }} /></div>
          <div className="ai-bar-v">{nfmt(vals[i])}</div>
        </div>
      ))}
    </div>
  );
}

function ProdCard({ p, rank }: { p: AsstProdotto; rank: number }) {
  const badge = p.disponibili == null ? null
    : p.disponibili <= 0 ? { c: 'out', t: 'Esaurito' }
      : p.disponibili <= 2 ? { c: 'low', t: `${p.disponibili} rimaste` }
        : { c: 'ok', t: `${p.disponibili} a stock` };
  const metric = p.valore != null ? `${nfmt(p.valore)}${p.valore_label ? ' ' + p.valore_label : ''}`
    : p.venduto_tot != null ? `${nfmt(p.venduto_tot)} vend.` : '';
  return (
    <div className="ai-pc">
      <div className="ai-pc-im" style={p.image_url ? { backgroundImage: `url('${p.image_url}')` } : undefined}>
        {!p.image_url && <span className="ai-pc-ph"><Spark s={20} /></span>}
        <span className="ai-pc-rk">{rank}</span>
      </div>
      <div className="ai-pc-bd">
        <div className="ai-pc-nm">{p.nome || p.codice}</div>
        {p.variante && <div className="ai-pc-vr">{p.variante}</div>}
        <div className="ai-pc-mt">
          {metric && <span className="ai-pc-sold">{metric}</span>}
          {p.prezzo != null && <span className="ai-pc-pr">{nfmt(p.prezzo)}€</span>}
        </div>
        {badge && <span className={`ai-badge ${badge.c}`}>{badge.t}</span>}
      </div>
    </div>
  );
}

function Answer({ res }: { res: AsstResult }) {
  const righe = res.righe ?? [];
  const cols = righe.length ? Object.keys(righe[0]) : [];
  const cell = (v: unknown) => typeof v === 'number' ? nfmt(v) : String(v ?? '');
  return (
    <div className="ai-a">
      <div className="ai-who"><span className="ai-who-m"><Spark s={12} /></span><span>Amimì</span></div>
      {res.error && <p className="err">{res.error}</p>}
      {res.needs_key && <p className="ai-note">Per l'assistente serve la chiave Google AI in <code>app_flags.gemini_api_key</code>.</p>}
      {res.testo && <p>{res.testo}</p>}
      {res.grafico && res.grafico.valori?.length ? <Chart g={res.grafico} /> : null}
      {res.prodotti?.length ? (
        <div className="ai-grid">{res.prodotti.map((p, i) => <ProdCard key={p.codice + i} p={p} rank={i + 1} />)}</div>
      ) : null}
      {(res.sql || righe.length) ? (
        <details className="ai-src">
          <summary>Fonti ({righe.length} righe)</summary>
          {res.sql && <div className="ai-sql">{res.sql}</div>}
          {righe.length ? (
            <div className="tablewrap"><table><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{righe.slice(0, 20).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{cell((r as Record<string, unknown>)[c])}</td>)}</tr>)}</tbody></table></div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

// Fase 3: confirmation card for a PROPOSED action. The assistant only proposes; the write happens here,
// via write-api, ONLY after the user reviews/adjusts and confirms. Expense proposals land pending.
function ActionCard({ azione, pin, chi }: { azione: AsstAzione; pin: string; chi: string }) {
  const [costo, setCosto] = useState(String(azione.payload.costo));
  const [categoria, setCategoria] = useState(azione.payload.categoria);
  const [operazione, setOperazione] = useState(azione.payload.operazione);
  const [amimi, setAmimi] = useState(azione.payload.amimi);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'cancel'>('idle');
  const [msg, setMsg] = useState('');
  const okToSend = Number(costo) > 0 && !!categoria;

  async function conferma() {
    if (!okToSend || state === 'busy') return;
    setState('busy'); setMsg('');
    try {
      const r = await writeApi('expense_propose', { costo: Number(costo), categoria, operazione: operazione.trim() || 'Spesa', amimi }, pin, chi) as { ok?: boolean; error?: string };
      if (r.ok) { setState('done'); setMsg('Proposta registrata: resta in attesa di approvazione in Registra › Spese.'); }
      else { setMsg(r.error || 'Errore'); setState('idle'); }
    } catch (e) { setMsg((e as Error).message); setState('idle'); }
  }

  if (state === 'done') return <div className="ai-a"><div className="ai-action-ok"><span className="ai-who-m"><Spark s={12} /></span> ✓ {msg}</div></div>;
  if (state === 'cancel') return <div className="ai-a"><div className="ai-action-cancel">Proposta annullata.</div></div>;

  return (
    <div className="ai-a">
      <div className="ai-who"><span className="ai-who-m"><Spark s={12} /></span><span>Amimì</span></div>
      <div className="ai-action">
        <div className="ai-action-h">Registro questa spesa?</div>
        <div className="ai-action-grid">
          <label>Importo €<input type="number" inputMode="decimal" min="0" value={costo} onChange={(e) => setCosto(e.target.value)} /></label>
          <label>Categoria
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">— scegli —</option>
              {azione.categoria_valide.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="wide">Causale<input value={operazione} onChange={(e) => setOperazione(e.target.value)} /></label>
          <label className="chk"><input type="checkbox" checked={amimi} onChange={(e) => setAmimi(e.target.checked)} /> Spesa Amimì</label>
        </div>
        <div className="ai-action-note">Resta in attesa di approvazione: non tocca il conto economico finché non la approvi in Registra › Spese.</div>
        {msg && <div className="err ai-action-err">{msg}</div>}
        <div className="ai-action-btns">
          <button className="ai-action-no" type="button" onClick={() => setState('cancel')}>Annulla</button>
          <button className="ai-action-yes" type="button" disabled={!okToSend || state === 'busy'} onClick={conferma}>{state === 'busy' ? 'Registro…' : 'Conferma e proponi'}</button>
        </div>
      </div>
    </div>
  );
}

// Printable report of one answer (question + text + chart + product cards), rendered into a body-level
// portal and shown only in @media print, so "Salva come report" -> the browser's Save as PDF / share.
function PrintReport({ turn }: { turn: Turn }) {
  const res = turn.res;
  const righe = res?.righe ?? [];
  const oggi = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  return (
    <div className="ai-report">
      <div className="ai-report-head">
        <span className="ai-report-mark"><Spark s={22} /></span>
        <div><div className="ai-report-ttl">Amimì · Assistente</div><div className="ai-report-date">{oggi}</div></div>
      </div>
      <div className="ai-report-q">{turn.user}</div>
      {res?.testo && <p className="ai-report-testo">{res.testo}</p>}
      {res?.grafico && res.grafico.valori?.length ? <Chart g={res.grafico} /> : null}
      {res?.prodotti?.length ? <div className="ai-grid">{res.prodotti.map((p, i) => <ProdCard key={p.codice + i} p={p} rank={i + 1} />)}</div> : null}
      <div className="ai-report-foot">Dati Amimì in tempo reale{righe.length ? ` · ${righe.length} righe` : ''} · non modifica nulla</div>
    </div>
  );
}

export default function AssistantPanel({ pin, chi }: { pin: string; chi: string }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<Turn[]>([]);
  const [printTurn, setPrintTurn] = useState<Turn | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchOpsFlags().then((f) => setEnabled(f.ai_enabled)).catch(() => {}); }, []);
  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [thread, busy, open]);
  // once the print portal has rendered, open the print / Save-as-PDF dialog; clear when done
  useEffect(() => {
    if (!printTurn) return;
    const done = () => setPrintTurn(null);
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 80);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printTurn]);

  if (!enabled) return null;

  async function ask(question?: string) {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ('');
    // session memory: send the prior turns so follow-ups ("e le esaurite?") resolve
    const storia: AsstMsg[] = thread.flatMap((t) => [
      { ruolo: 'user', testo: t.user } as AsstMsg,
      ...(t.res?.testo ? [{ ruolo: 'assistant', testo: t.res.testo } as AsstMsg] : []),
    ]);
    setThread((t) => [...t, { user: text }]);
    setBusy(true);
    let res: AsstResult;
    try { res = await askAssistant(text, storia, pin); }
    catch (e) { res = { error: (e as Error).message }; }
    setThread((t) => { const c = [...t]; c[c.length - 1] = { user: text, res }; return c; });
    setBusy(false);
  }

  return (
    <>
      <button className={`ai-fab ${open ? 'hide' : ''}`} onClick={() => setOpen(true)} type="button" aria-label="Apri assistente">
        <Spark /> Chiedi ad Amimì
      </button>
      {open && <div className="ai-scrim" onClick={() => setOpen(false)} />}
      <div className={`ai-panel ${open ? 'open' : ''}`} role="dialog" aria-label="Assistente Amimì" aria-hidden={!open}>
        <div className="ai-grip" />
        <div className="ai-head">
          <div className="ai-mark"><Spark s={19} /></div>
          <div>
            <div className="ai-ttl">Assistente Amimì</div>
            <span className="ai-chip"><span className="ai-dot" />dati live · sola lettura</span>
          </div>
          <span style={{ flex: 1 }} />
          <button className="ai-x" onClick={() => setOpen(false)} type="button" aria-label="Chiudi">✕</button>
        </div>

        <div className="ai-thread" ref={threadRef}>
          {thread.length === 0 && (
            <div className="ai-empty">
              <div className="ai-empty-m"><Spark s={26} /></div>
              <p>Chiedimi dei tuoi dati: vendite, stock, riordini, conto economico. Rispondo con numeri veri, grafici e le foto dei prodotti.</p>
            </div>
          )}
          {thread.map((t, i) => (
            <div key={i}>
              <div className="ai-u">{t.user}</div>
              {t.res?.azione ? <ActionCard azione={t.res.azione} pin={pin} chi={chi} />
                : t.res ? <Answer res={t.res} /> : null}
              {t.res && t.res.testo && !t.res.error && !t.res.gated && !t.res.needs_key ? (
                <button className="ai-export" type="button" onClick={() => setPrintTurn(t)}>
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9V4h12v5M6 18H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1M8 15h8v5H8z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Salva come report
                </button>
              ) : null}
            </div>
          ))}
          {busy && <div className="ai-a ai-typing"><span className="ai-who-m"><Spark s={12} /></span> Sto guardando i dati…</div>}
        </div>

        <div className="ai-chips">{CHIPS.map((c) => <button key={c} className="ai-chipbtn" type="button" onClick={() => ask(c)}>{c}</button>)}</div>
        <div className="ai-composer">
          <input className="ai-field" placeholder="Chiedi qualcosa sui tuoi dati…" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
          <button className="ai-send" onClick={() => ask()} type="button" disabled={busy} aria-label="Invia">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        <div className="ai-foot">Legge i tuoi dati in tempo reale · non modifica nulla</div>
      </div>
      {printTurn && createPortal(<div className="ai-print-portal"><PrintReport turn={printTurn} /></div>, document.body)}
    </>
  );
}
