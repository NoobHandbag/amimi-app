import { useEffect, useState } from 'react';
import { fetchMovimenti14gg, fetchOpsFlags, fetchHealthLatest, fetchOpsExtra } from '../lib/api';
import type { Movimenti, OpsFlags, HealthRow } from '../lib/api';

// Pagina "Salute & Movimenti" (sola lettura). Polso vendite online+offline ultimi 14gg vs 14 precedenti,
// movimenti operativi, catalogo Shopify e semaforo salute (health_log dell'ecosistema, popolato da ce-guard).
// I numeri vendite/movimenti/catalogo vengono da v_movimenti_14gg: stessa finestra del digest Cowork.

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat('it-IT').format(n || 0);
const SEV_COLOR: Record<string, string> = { bad: 'var(--red, #c83c46)', warn: '#c98a1a', ok: 'var(--green, #2e9e5b)' };

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

export default function Salute({ onBack }: { onBack?: () => void }) {
  const [m, setM] = useState<Movimenti | null>(null);
  const [flags, setFlags] = useState<OpsFlags | null>(null);
  const [health, setHealth] = useState<{ day: string | null; rows: HealthRow[] }>({ day: null, rows: [] });
  const [extra, setExtra] = useState<{ lastQromo: string | null; unfulfilledRecent: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [mv, fl, hl, ex] = await Promise.all([fetchMovimenti14gg(), fetchOpsFlags(), fetchHealthLatest(), fetchOpsExtra()]);
        setM(mv); setFlags(fl); setHealth(hl); setExtra(ex);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="screen"><p className="muted center">Carico salute e movimenti…</p></div>;
  if (err) return <div className="screen"><div className="card err">Errore: {err}</div></div>;
  if (!m) return null;

  const bad = health.rows.filter((r) => r.severity === 'bad');
  const warn = health.rows.filter((r) => r.severity === 'warn');
  const ok = health.rows.filter((r) => r.severity === 'ok');
  const alerts = [...bad, ...warn];
  const overall = bad.length ? 'bad' : warn.length ? 'warn' : 'ok';
  const overallLabel = overall === 'bad' ? 'Da sistemare' : overall === 'warn' ? 'Da tenere d’occhio' : 'Tutto in ordine';

  const totCh = (m.on_lordo14 + m.off_lordo14) || 1;
  const qromoDays = extra?.lastQromo ? Math.round((Date.now() - new Date(extra.lastQromo).getTime()) / 86400000) : null;
  const healthDay = health.day ? new Date(health.day).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : null;

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
        <div style={{ display: 'flex', gap: 8, margin: '10px 0 4px', flexWrap: 'wrap' }}>
          <span className="pill" style={{ color: SEV_COLOR.bad, border: `1px solid ${SEV_COLOR.bad}`, borderRadius: 999, padding: '2px 10px', fontWeight: 700, fontSize: 13 }}>{bad.length} da sistemare</span>
          <span className="pill" style={{ color: SEV_COLOR.warn, border: `1px solid ${SEV_COLOR.warn}`, borderRadius: 999, padding: '2px 10px', fontWeight: 700, fontSize: 13 }}>{warn.length} avvisi</span>
          <span className="pill" style={{ color: SEV_COLOR.ok, border: `1px solid ${SEV_COLOR.ok}`, borderRadius: 999, padding: '2px 10px', fontWeight: 700, fontSize: 13 }}>{ok.length} ok</span>
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
