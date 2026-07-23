import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  fetchMovimenti14gg, fetchOpsFlags, fetchHealthLatest, fetchOpsExtra,
  fetchDigestPersone, fetchDigestVersioni, fetchDigestOrdini, fetchDigestPulizia, fetchDigestSpese, fetchDigestLogAttori,
  fetchExpensesReview,
} from '../lib/api';
import type { Movimenti, OpsFlags, HealthRow, DigestPersone, DigestOrdine, DigestPulizia, DigestSpesa, DigestAttore } from '../lib/api';
import ActivityFeed from '../components/ActivityFeed';
import Icon from '../components/Icon';

type Go = (t: 'registra' | 'magazzino', p?: string) => void;

// Pagina "Salute & Movimenti" (sola lettura). Semaforo salute ecosistema, movimenti per persona
// (Ginevra=ordini, Benedetta=catalogo/resi/spese, Dan[=Ale]=sistema) con KPI cliccabili e drill-down,
// e il polso vendite/movimenti/catalogo generale. Numeri live da Supabase (viste v_digest_* e v_movimenti_14gg).

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const eur2 = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat('it-IT').format(n || 0);
const fmtDay = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) : '—');
const trunc = (s: string | null, n: number) => (!s ? '—' : s.length > n ? s.slice(0, n) + '…' : s);
const SEV_COLOR: Record<string, string> = { bad: 'var(--red, #c83c46)', error: 'var(--red, #c83c46)', warn: '#c98a1a', ok: 'var(--green, #2e9e5b)' };
const sevColor = (s: string) => SEV_COLOR[s] ?? 'var(--muted, #8a7f84)';
const sevRank = (s: string) => (s === 'bad' || s === 'error' ? 0 : s === 'warn' ? 1 : 2);

// Edge-function versions: NOT in the database, so kept as a static reference updated at each release.
// Verified live via Supabase on 2026-07-08. The migrations count (KPI headline) is live from v_digest_versioni.
const EDGE_FUNCTIONS: { slug: string; v: number }[] = [
  { slug: 'write-api', v: 16 }, { slug: 'shopify-stock', v: 10 }, { slug: 'qromo-webhook', v: 5 },
  { slug: 'shopify-sync', v: 5 }, { slug: 'ask-data', v: 4 }, { slug: 'mcp', v: 4 },
  { slug: 'etl-load', v: 4 }, { slug: 'ce-guard', v: 2 },
];

type Persona = 'Ginevra' | 'Benedetta' | 'Dan';
const PERSONE: Persona[] = ['Ginevra', 'Benedetta', 'Dan'];
const ROLE: Record<Persona, string> = {
  Ginevra: 'Ordini online (Shopify). Delta rispetto ai 14 giorni precedenti.',
  Benedetta: 'Catalogo, resi e spese: pulizia dati, gestione resi/cambi, conferma spese.',
  Dan: 'Sistema: attività registrata, versioni, salute e riconciliazioni contabili. (Dan = Ale.)',
};
const chiToPersona = (c: string): Persona => {
  const k = (c || '').toLowerCase();
  if (k.startsWith('bene') || k.startsWith('benny')) return 'Benedetta';
  if (k.startsWith('gin')) return 'Ginevra';
  return 'Dan'; // Ale (+ fallback)
};

function deltaPct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return (cur - prev) / prev;
}
function Delta({ cur, prev, goodUp = true }: { cur: number; prev: number; goodUp?: boolean }) {
  const d = deltaPct(cur, prev);
  if (d == null) return <span style={{ color: 'var(--muted, #8a7f84)', fontSize: 12 }}>—</span>;
  const up = d >= 0;
  const good = goodUp ? up : !up;
  const color = d === 0 ? 'var(--muted, #8a7f84)' : good ? 'var(--green, #2e9e5b)' : 'var(--red, #c83c46)';
  return <span style={{ color, fontSize: 12, fontWeight: 700 }}>{up ? '▲' : '▼'} {Math.abs(d * 100).toLocaleString('it-IT', { maximumFractionDigits: 0 })}%</span>;
}

function Stat({ label, value, cur, prev, goodUp = true, sub, tone = 'accent' }: { label: string; value: string; cur?: number; prev?: number; goodUp?: boolean; sub?: string; tone?: string }) {
  return (
    <div className={`kpi ${tone}`}>
      <div className="v">{value}</div>
      <div className="k">{label}</div>
      <div className="ksub">{cur != null && prev != null ? <Delta cur={cur} prev={prev} goodUp={goodUp} /> : null}{sub ? <span style={{ marginLeft: cur != null ? 6 : 0 }}>{sub}</span> : null}</div>
    </div>
  );
}

// Clickable KPI: same look as Stat, plus a drill toggle. Every DKpi opens a detail panel below the grid.
function DKpi({ id, open, setOpen, value, label, cur, prev, goodUp = true, sub, tone = 'accent' }: { id: string; open: string | null; setOpen: (s: string | null) => void; value: ReactNode; label: string; cur?: number; prev?: number; goodUp?: boolean; sub?: string; tone?: string }) {
  const on = open === id;
  const toggle = () => setOpen(on ? null : id);
  return (
    <div className={`kpi ${tone} clickable${on ? ' on' : ''}`} role="button" tabIndex={0}
      onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
      <span className="tap">{on ? '▴' : '▾'}</span>
      <div className="v">{value}</div>
      <div className="k">{label}</div>
      <div className="ksub">{cur != null && prev != null ? <Delta cur={cur} prev={prev} goodUp={goodUp} /> : null}{sub ? <span style={{ marginLeft: cur != null ? 6 : 0 }}>{sub}</span> : null}</div>
    </div>
  );
}

export default function Salute({ onBack, chi, go }: { onBack?: () => void; chi?: string; go?: Go }) {
  const [m, setM] = useState<Movimenti | null>(null);
  const [speseReview, setSpeseReview] = useState(0);
  const [flags, setFlags] = useState<OpsFlags | null>(null);
  const [health, setHealth] = useState<{ day: string | null; rows: HealthRow[] }>({ day: null, rows: [] });
  const [extra, setExtra] = useState<{ lastQromo: string | null; unfulfilledRecent: number } | null>(null);
  const [d, setD] = useState<DigestPersone | null>(null);
  const [migr, setMigr] = useState<number | null>(null);
  const [ordini, setOrdini] = useState<DigestOrdine[]>([]);
  const [pulizia, setPulizia] = useState<DigestPulizia[]>([]);
  const [spese, setSpese] = useState<DigestSpesa[]>([]);
  const [attori, setAttori] = useState<DigestAttore[]>([]);
  const [persona, setPersona] = useState<Persona>(() => chiToPersona(chi ?? ''));
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [mv, fl, hl, ex, dg, vr, or, pu, sp, la] = await Promise.all([
          fetchMovimenti14gg(), fetchOpsFlags(), fetchHealthLatest(), fetchOpsExtra(),
          fetchDigestPersone(), fetchDigestVersioni(), fetchDigestOrdini(), fetchDigestPulizia(), fetchDigestSpese(), fetchDigestLogAttori(),
        ]);
        setM(mv); setFlags(fl); setHealth(hl); setExtra(ex);
        setD(dg); setMigr(vr.migr_n); setOrdini(or); setPulizia(pu); setSpese(sp); setAttori(la);
        fetchExpensesReview().then((r) => setSpeseReview(r.length)).catch(() => {});
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="screen"><p className="muted center">Carico salute e movimenti…</p></div>;
  if (err) return <div className="screen"><div className="card err">Errore: {err}</div></div>;
  if (!m || !d) return null;

  const bad = health.rows.filter((r) => r.severity === 'bad' || r.severity === 'error');
  const warn = health.rows.filter((r) => r.severity === 'warn');
  const ok = health.rows.filter((r) => r.severity === 'ok');
  const alerts = [...bad, ...warn];
  const overall = bad.length ? 'bad' : warn.length ? 'warn' : 'ok';
  const overallLabel = overall === 'bad' ? 'Da sistemare' : overall === 'warn' ? 'Da tenere d’occhio' : 'Tutto in ordine';

  const totCh = (m.on_lordo14 + m.off_lordo14) || 1;
  const qromoDays = extra?.lastQromo ? Math.round((Date.now() - new Date(extra.lastQromo).getTime()) / 86400000) : null;
  const healthDay = health.day ? new Date(health.day).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : null;

  const healthSorted = [...health.rows].sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.k.localeCompare(b.k));
  const ceRows = healthSorted.filter((r) => /^ce_/.test(r.k) || r.k === 'period_mismatch');
  const aperti = extra?.unfulfilledRecent ?? 0;

  const drill = (): ReactNode => {
    switch (open) {
      // ---- Ginevra ----
      case 'g_ord': return (
        <><h3>Ordini aggiunti — ultimi 14gg ({ordini.length})</h3>
          <div className="dscroll"><table className="dtable"><thead><tr><th>#</th><th>Cliente</th><th>Data</th><th>Stato</th><th className="num">Lordo</th></tr></thead>
            <tbody>{ordini.slice(0, 50).map((o, i) => (<tr key={o.order_number ?? i}><td>{o.order_number ?? '—'}</td><td>{o.customer_name ?? '—'}</td><td>{fmtDay(o.data)}</td><td>{o.evaso ? 'evaso' : 'da evadere'}</td><td className="num">{o.gross_total != null ? eur2(o.gross_total) : '—'}</td></tr>))}</tbody></table></div>
          {ordini.length > 50 && <p className="note">Mostrati i primi 50 di {ordini.length}.</p>}</>
      );
      case 'g_ev': return (
        <><h3>Ordini evasi — {num(d.gin_evasi14)} negli ultimi 14gg</h3>
          <p className="note">Conteggio per data di evasione (fulfilled_at). Periodo precedente: {num(d.gin_evasi28)}. La freschezza delle liste di spedizione (corriere TWS, senza API) è nel digest email di Cowork.</p></>
      );
      case 'g_ap': return (
        <><h3>Aperti da evadere — {num(aperti)} recenti</h3>
          <p className="note">Ordini degli ultimi 30 giorni ancora da spedire (indicatore informativo, non un allarme). <strong>Nota dati:</strong> esistono 181 ordini “unfulfilled” pre-migrazione, tutti oltre 30gg: residuo dello stato di evasione importato, esclusi di proposito.</p></>
      );
      case 'g_aov': return (
        <><h3>Scontrino medio online — {d.gin_aov14 != null ? eur(d.gin_aov14) : '—'}</h3>
          <p className="note">Lordo online degli ultimi 14gg diviso gli ordini online del periodo. IVA inclusa. Riguarda i soli ordini Shopify: le vendite in negozio sono nel “Polso vendite” più sotto.</p></>
      );
      // ---- Benedetta ----
      case 'b_pul': return (
        <><h3>Nomi ripuliti — operazioni di pulizia (14gg)</h3>
          <div className="dscroll"><table className="dtable"><thead><tr><th>Data</th><th>Operazione</th><th>Chi</th><th>Tabella</th></tr></thead>
            <tbody>{pulizia.slice(0, 50).map((p, i) => (<tr key={i}><td>{fmtDay(p.data)}</td><td>{p.op ?? '—'}</td><td>{p.chi ?? '—'}</td><td>{p.tbl ?? '—'}</td></tr>))}</tbody></table></div>
          <p className="note">Conta maiuscole item/variante, merge varianti, finalize/normalizza codice — da chiunque le esegua. Nel periodo sono per lo più batch del 06-07; le pulizie manuali future compaiono col nome di chi le fa.</p></>
      );
      case 'b_resi': return (
        <><h3>Resi / cambi — {num(d.ben_resi14)} nel periodo</h3>
          <p className="note">Reso o cambio registrati in app negli ultimi 14gg (tutti i canali). Un cambio si distingue dal reso perché ha un prodotto sostitutivo.{d.ben_resi14 === 0 ? ' Nessuno nel periodo.' : ''}</p></>
      );
      case 'b_spese': return (
        <><h3>Spese confermate — {num(d.ben_spese14)} azioni (14gg)</h3>
          <div className="dscroll"><table className="dtable"><thead><tr><th>Data</th><th>Descrizione</th><th>Chi</th><th className="num">Importo</th></tr></thead>
            <tbody>{spese.slice(0, 50).map((s, i) => (<tr key={i}><td>{fmtDay(s.data)}</td><td>{trunc(s.operazione, 56)}</td><td>{s.chi ?? '—'}</td><td className="num">{s.costo != null ? eur2(s.costo) : '—'}</td></tr>))}</tbody></table></div>
          <p className="note">Conferme reali fatte a mano (expense_approve + expense_manual nel change_log), non l’import bulk delle spese.</p></>
      );
      case 'b_todo': return (
        <><h3>Prodotti da completare — {num(d.ben_todo)}</h3>
          <p className="note">Prodotti in coda pulizia dati (mancano immagine, prezzo, COGS, SEO o verifica). Apri “Pulizia dati” dalla Home per la lista completa e la scheda di ciascuno.</p></>
      );
      // ---- Dan (= Ale) ----
      case 'd_log': return (
        <><h3>Log totali — {num(d.dan_log14)} voci (14gg), per attore</h3>
          <div className="dscroll"><table className="dtable"><thead><tr><th>Attore</th><th className="num">Voci</th></tr></thead>
            <tbody>{attori.map((a, i) => (<tr key={i}><td>{a.chi ?? '—'}</td><td className="num">{num(a.n)}</td></tr>))}</tbody></table></div>
          <p className="note">Tutte le scritture al database tracciate (change_log): include attori automatici (cron, webhook Qromo) e umani.</p></>
      );
      case 'd_ver': return (
        <><h3>Versioni — {num(migr ?? 0)} migrazioni DB + {EDGE_FUNCTIONS.length} edge function</h3>
          <div className="dscroll"><table className="dtable"><thead><tr><th>Edge function</th><th className="num">Versione</th></tr></thead>
            <tbody>{EDGE_FUNCTIONS.map((f) => (<tr key={f.slug}><td>{f.slug}</td><td className="num">v{f.v}</td></tr>))}</tbody></table></div>
          <p className="note">Le migrazioni sono contate dal vivo dal database. Le versioni delle edge function sono un riferimento aggiornato al rilascio (08-07-2026), non stanno nel database.</p></>
      );
      case 'd_health': return (
        <><h3>Salute sistema — {num(d.dan_health_ok)} ok · {num(d.dan_health_warn)} avvisi · {num(d.dan_health_bad)} da sistemare</h3>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7 }}>
            {healthSorted.map((r) => (<li key={r.k}><span style={{ color: sevColor(r.severity), fontWeight: 700 }}>&bull;</span> {r.label}{r.n ? <strong> ({num(r.n)})</strong> : null}</li>))}
          </ul>
          <p className="note">Semaforo dal giro giornaliero di ce-guard (health_log).{healthDay ? ` Ultimo check ${healthDay}.` : ''}</p></>
      );
      case 'd_ce': return (
        <><h3>Riconciliazioni CE — {num(d.dan_ce_bad)} da sistemare</h3>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7 }}>
            {ceRows.map((r) => (<li key={r.k}><span style={{ color: sevColor(r.severity), fontWeight: 700 }}>&bull;</span> {r.label}{r.n ? <strong> ({num(r.n)})</strong> : null}</li>))}
          </ul>
          <p className="note">Voci del guardiano contabile ce-guard (giro giornaliero). Verde = a posto, rosso = da correggere.</p></>
      );
      default: return null;
    }
  };

  return (
    <div className="screen">
      <header>
        <h1>Amim&igrave; &middot; Salute &amp; Movimenti</h1>
        <div className="operbar"><span className="badge">ultimi 14 giorni</span></div>
      </header>
      {onBack && <button className="back" onClick={onBack}>&larr; Home</button>}

      {/* Semaforo salute ecosistema (health_log dell'ultimo giro ce-guard) */}
      <section className="card" style={{ borderLeft: `4px solid ${SEV_COLOR[overall]}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: SEV_COLOR[overall], display: 'inline-block' }} />
          <h2 style={{ margin: 0 }}>Salute ecosistema: {overallLabel}</h2>
          {healthDay && <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>check {healthDay}</span>}
        </div>
        <div className="ds-hbar">
          <div className="ok" style={{ flex: ok.length || 0.001 }} />
          <div className="warn" style={{ flex: warn.length || 0.001 }} />
          <div className="bad" style={{ flex: bad.length || 0.001 }} />
        </div>
        <div className="ds-hlegend">
          <span><i style={{ background: 'var(--positive)' }} />{ok.length} ok</span>
          <span><i style={{ background: 'var(--warning)' }} />{warn.length} avvisi</span>
          <span><i style={{ background: 'var(--negative)' }} />{bad.length} da sistemare</span>
        </div>
        {alerts.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
            {alerts.map((r) => (
              <li key={r.k} style={{ color: 'var(--dark, #2d2226)' }}>
                <span style={{ color: SEV_COLOR[r.severity], fontWeight: 700 }}>&bull;</span> {r.label}{r.n ? <strong> ({num(r.n)})</strong> : null}
              </li>
            ))}
          </ul>
        )}
        {!health.day && <p className="note">Nessun dato health_log disponibile.</p>}
      </section>

      {/* Voci cliccabili "da sistemare": portano dritto alla schermata giusta (§4.8) */}
      {go && (() => {
        const todos = [
          speseReview > 0 && { n: speseReview, label: 'spese da verificare', icon: 'euro', tint: ['--warning-tint', '--warning-700'] as const, act: () => go('registra', 'spesa') },
          m.soldout > 0 && { n: m.soldout, label: 'SKU pubblicati ma esauriti', icon: 'box', tint: ['--negative-tint', '--negative-700'] as const, act: () => go('magazzino') },
          d.ben_todo > 0 && { n: d.ben_todo, label: 'prodotti da completare', icon: 'tag', tint: ['--interactive-tint', '--interactive-700'] as const, act: () => go('registra', 'pulizia') },
        ].filter(Boolean) as { n: number; label: string; icon: string; tint: readonly [string, string]; act: () => void }[];
        if (!todos.length) return null;
        return (
          <>
            <div className="ds-seclb" style={{ marginTop: 6 }}>Da sistemare <span className="c">{todos.length}</span></div>
            {todos.map((t, i) => (
              <button key={i} type="button" className="ds-todo" onClick={t.act}>
                <span className="ic" style={{ background: `var(${t.tint[0]})`, color: `var(${t.tint[1]})` }}><Icon name={t.icon} size={18} /></span>
                <span className="tt">{t.label}</span>
                <span className="tn" style={{ color: `var(${t.tint[1]})` }}>{t.n}</span>
                <span className="chev">›</span>
              </button>
            ))}
          </>
        );
      })()}

      {/* Movimenti per persona (Ginevra / Benedetta / Dan): KPI cliccabili con drill-down */}
      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Movimenti per persona &middot; 14gg</h2>
          <div className="seg wrap" style={{ marginLeft: 'auto' }}>
            {PERSONE.map((p) => (
              <button key={p} className={persona === p ? 'on' : ''} onClick={() => { setPersona(p); setOpen(null); }} type="button">{p}</button>
            ))}
          </div>
        </div>
        <p className="note" style={{ marginTop: 0, marginBottom: 12 }}>{ROLE[persona]}</p>

        <div className="kpis">
          {persona === 'Ginevra' && <>
            <DKpi id="g_ord" open={open} setOpen={setOpen} value={num(d.gin_ordini14)} label="Ordini aggiunti" cur={d.gin_ordini14} prev={d.gin_ordini28} sub="vs 14gg prec." tone="green" />
            <DKpi id="g_ev" open={open} setOpen={setOpen} value={num(d.gin_evasi14)} label="Ordini evasi" cur={d.gin_evasi14} prev={d.gin_evasi28} sub="vs prec." tone="accent" />
            <DKpi id="g_ap" open={open} setOpen={setOpen} value={num(aperti)} label="Aperti da evadere" sub="recenti (30gg)" tone="rose" />
            <DKpi id="g_aov" open={open} setOpen={setOpen} value={d.gin_aov14 != null ? eur(d.gin_aov14) : '—'} label="Scontrino medio" sub="AOV online" tone="accent" />
          </>}
          {persona === 'Benedetta' && <>
            <DKpi id="b_pul" open={open} setOpen={setOpen} value={num(d.ben_puliti14)} label="Nomi ripuliti" sub="pulizia catalogo" tone="green" />
            <DKpi id="b_resi" open={open} setOpen={setOpen} value={num(d.ben_resi14)} label="Resi / cambi" sub="ultimi 14gg" tone="accent" />
            <DKpi id="b_spese" open={open} setOpen={setOpen} value={num(d.ben_spese14)} label="Spese confermate" sub="azioni umane" tone="accent" />
            <DKpi id="b_todo" open={open} setOpen={setOpen} value={num(d.ben_todo)} label="Prodotti da completare" sub="coda pulizia" tone={d.ben_todo > 0 ? 'red' : 'green'} />
          </>}
          {persona === 'Dan' && <>
            <DKpi id="d_log" open={open} setOpen={setOpen} value={num(d.dan_log14)} label="Log totali" sub={`${num(d.dan_attori14)} attori`} tone="accent" />
            <DKpi id="d_ver" open={open} setOpen={setOpen} value={<>{num(migr ?? 0)}<span style={{ fontSize: 14 }}> +{EDGE_FUNCTIONS.length}</span></>} label="Versioni rilasciate" sub="migrazioni + edge fn" tone="green" />
            <DKpi id="d_health" open={open} setOpen={setOpen} value={`${num(d.dan_health_ok)}/${num(d.dan_health_warn)}/${num(d.dan_health_bad)}`} label="Salute sistema" sub="ok / avvisi / rossi" tone="accent" />
            <DKpi id="d_ce" open={open} setOpen={setOpen} value={num(d.dan_ce_bad)} label="Riconciliazioni CE" sub="da sistemare" tone={d.dan_ce_bad > 0 ? 'red' : 'green'} />
          </>}
        </div>
        {open && <div className="drill">{drill()}</div>}
      </section>

      {/* Polso vendite (online + offline combinati), 14gg vs 14 precedenti */}
      <section className="card">
        <h2>Polso vendite &middot; 14gg vs 14 precedenti</h2>
        <div className="kpis">
          <Stat label="Fatturato netto" value={eur(m.netto14)} cur={m.netto14} prev={m.netto28} sub="IVA esclusa" tone="accent" />
          <Stat label="Fatturato lordo" value={eur(m.lordo14)} cur={m.lordo14} prev={m.lordo28} sub="IVA incl." tone="rose" />
          <Stat label="Pezzi venduti" value={num(m.pezzi14)} cur={m.pezzi14} prev={m.pezzi28} sub={`${num(m.on_pezzi14)} online / ${num(m.off_pezzi14)} negozio`} tone="green" />
          <Stat label="Ordini online" value={num(m.ordini14)} cur={m.ordini14} prev={m.ordini28} sub={m.aov_lordo14 != null ? `AOV ${eur(m.aov_lordo14)}` : undefined} tone="accent" />
        </div>
        <div className="bar" style={{ marginTop: 6 }}>
          <div className="seg on" style={{ flex: m.on_lordo14 }} />
          <div className="seg of" style={{ flex: m.off_lordo14 || 0.0001 }} />
        </div>
        <div className="barleg">
          <span><i className="dot on" />Online {Math.round(m.on_lordo14 / totCh * 100)}% &middot; {eur(m.on_lordo14)}</span>
          <span><i className="dot of" />Negozio {Math.round(m.off_lordo14 / totCh * 100)}% &middot; {eur(m.off_lordo14)}</span>
        </div>
        <p className="note">Netto = Lordo / 1,22. Vendite online (Shopify) e offline (Qromo) combinate. Delta rispetto ai 14 giorni precedenti.</p>
      </section>

      {/* Movimenti operativi */}
      <section className="card">
        <h2>Movimenti operativi</h2>
        <div className="kpis">
          <Stat label="Nuovi ordini fornitori" value={num(m.sup_new14)} sub="ultimi 14gg" tone="accent" />
          <Stat label="Arrivi registrati" value={num(m.sup_arr14)} sub="ultimi 14gg" tone="green" />
          <Stat label="Ordini aperti" value={num(m.sup_open)} sub="in attesa di arrivo" tone="rose" />
          <Stat label="Resi" value={num(m.ret14)} cur={m.ret14} prev={m.ret28} goodUp={false} sub="ultimi 14gg" tone="accent" />
        </div>
      </section>

      {/* Catalogo Shopify + flag operativi */}
      <section className="card">
        <h2>Catalogo Shopify</h2>
        <div className="kpis">
          <Stat label="Prodotti live" value={num(m.live)} sub="ACTIVE" tone="green" />
          <Stat label="Bozze" value={num(m.draft)} sub="draft" tone="accent" />
          <Stat label="Esauriti ma pubblicati" value={num(m.soldout)} sub="live a 0" tone={m.soldout > 0 ? 'red' : 'green'} />
        </div>
        {flags && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <Flag on={flags.write} label="Scrittura Shopify" />
            <Flag on={flags.autopush} label="Autopush stock" />
            <Flag on={flags.hold_raises} label="Blocca rialzi" neutral />
            <span className="pill" style={{ border: '1px solid var(--line, #e6ddd8)', borderRadius: 999, padding: '2px 10px', fontSize: 13, color: 'var(--muted, #8a7f84)' }}>Buffer esposizione: {flags.expose_buffer}</span>
          </div>
        )}
      </section>

      {/* Spedizioni & offline: proxy informativi (nessuna API corriere) */}
      <section className="card">
        <h2>Spedizioni &amp; offline</h2>
        <div className="list">
          <div className="row">
            <div><div className="rt">Ordini online da evadere</div><div className="rs">recenti (ultimi 30gg) non ancora spediti &middot; informativo</div></div>
            <div className="giac">{num(extra?.unfulfilledRecent ?? 0)}</div>
          </div>
          <div className="row">
            <div><div className="rt">Ultima vendita in negozio (Qromo)</div><div className="rs">le vendite offline sono saltuarie: normale qualche giorno a zero</div></div>
            <div className="giac" style={{ fontSize: 14 }}>{extra?.lastQromo ? `${new Date(extra.lastQromo).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}${qromoDays != null ? ` (${qromoDays}g fa)` : ''}` : '—'}</div>
          </div>
        </div>
        <p className="note">Il corriere TWS non ha API: la freschezza delle liste LDV la controlla il digest Cowork via email. Qui sopra sono indicatori informativi, non allarmi.</p>
      </section>

      {/* Attività recente: feed "chi ha fatto cosa quando" dal change_log (§6) */}
      <ActivityFeed />
    </div>
  );
}

function Flag({ on, label, neutral = false }: { on: boolean; label: string; neutral?: boolean }) {
  const color = neutral ? 'var(--muted, #8a7f84)' : on ? 'var(--green, #2e9e5b)' : 'var(--red, #c83c46)';
  return (
    <span className="pill" style={{ border: `1px solid ${color}`, color, borderRadius: 999, padding: '2px 10px', fontSize: 13, fontWeight: 700 }}>
      {on ? '●' : '○'} {label}
    </span>
  );
}
