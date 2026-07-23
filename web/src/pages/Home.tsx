import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PERSONA, PersonaPicker, personaName, ALL_ACTIONS } from '../lib/people';
import type { Tab, Tile } from '../lib/people';
import { nowMonth, nowYear, meseNome } from '../lib/helpers';
import Icon from '../components/Icon';
import HealthBanner from '../components/HealthBanner';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);

// tinta icon-tile per nome icona (bg tint + stroke 700). Semantico dove ha senso.
const TC: Record<string, [string, string]> = {
  bag: ['--negative-tint', '--negative-700'], rocket: ['--negative-tint', '--negative-700'],
  chart: ['--interactive-tint', '--interactive-700'], plus: ['--interactive-tint', '--interactive-700'],
  box: ['--interactive-tint', '--interactive-700'], inbox: ['--interactive-tint', '--interactive-700'],
  table: ['--interactive-tint', '--interactive-700'], tag: ['--interactive-tint', '--interactive-700'],
  count: ['--sec-lavender-tint', '--sec-lavender-700'], search: ['--sec-lavender-tint', '--sec-lavender-700'],
  store: ['--sec-lavender-tint', '--sec-lavender-700'],
  euro: ['--warning-tint', '--warning-700'], pulse: ['--warning-tint', '--warning-700'], sparkles: ['--warning-tint', '--warning-700'],
  recycle: ['--positive-tint', '--positive-700'], handshake: ['--positive-tint', '--positive-700'],
  return: ['--sec-cabaret-tint', '--sec-cabaret-700'],
};
const tileTint = (icon: string) => TC[icon] ?? ['--interactive-tint', '--interactive-700'];
const keyOf = (t: Tile) => `${t.tab}:${t.param ?? ''}`;
// azioni "di gestione" (mockup: Prodotti, Reso, B2B, Salute...) per il tier centrale
const GEST = new Set(['registra:catalogo', 'registra:product', 'registra:reso', 'registra:b2b', 'salute:', 'registra:pubblica']);

function sparkPoints(vals: number[], w = 150, h = 26): string {
  if (vals.length < 2) return `0,${h} ${w},${h}`;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  return vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join(' ');
}

export default function Home({ chi, setChi, go }: { chi: string; setChi: (c: string) => void; go: (t: Tab, p?: string) => void }) {
  const cfg = PERSONA[chi] ?? PERSONA.Ale;
  const [badges, setBadges] = useState({ arrivi: 0, todo: 0 });
  const [fin, setFin] = useState<{ netto: number; deltaPct: number | null; mc2: number; spark: number[] } | null>(null);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(() => localStorage.getItem('amimi_allact') !== '0');
  const toggleAll = () => setShowAll((v) => { localStorage.setItem('amimi_allact', v ? '0' : '1'); return !v; });

  useEffect(() => {
    (async () => {
      const [ord, todo] = await Promise.all([
        supabase.from('v_ordini_arrivo').select('completo'),
        supabase.from('v_products_todo').select('codice,bucket'),
      ]);
      setBadges({
        arrivi: (ord.data ?? []).filter((r: { completo: boolean }) => !r.completo).length,
        todo: (todo.data ?? []).filter((r: { bucket: string }) => r.bucket !== 'pulizia').length,
      });
      if (cfg.finance) {
        const ce = await supabase.from('v_ce_amimi_summary').select('month,omni_netto,mc2').eq('year', nowYear());
        const rows = ((ce.data ?? []) as { month: number; omni_netto: number; mc2: number }[]).sort((a, b) => a.month - b.month);
        const m = nowMonth();
        const cur = rows.find((r) => r.month === m);
        const prev = rows.find((r) => r.month === m - 1);
        const netto = cur ? Number(cur.omni_netto) : 0;
        const pNet = prev ? Number(prev.omni_netto) : 0;
        const closed = rows.filter((r) => r.month < m).reduce((s, r) => s + Number(r.mc2), 0);
        setFin({
          netto,
          deltaPct: pNet > 0 ? Math.round((netto - pNet) / pNet * 100) : null,
          mc2: closed,
          spark: rows.filter((r) => r.month <= m).map((r) => Number(r.omni_netto)),
        });
      }
    })();
  }, [chi, cfg.finance]);

  const badge = (b?: 'arrivi' | 'todo') => (b === 'arrivi' ? badges.arrivi : b === 'todo' ? badges.todo : 0);

  const { quick, gestione, altro } = useMemo(() => {
    const quick = cfg.tiles.slice(0, 4);
    const qk = new Set(quick.map(keyOf));
    const gest: Tile[] = [];
    const seen = new Set(qk);
    for (const t of [...cfg.tiles.slice(4), ...ALL_ACTIONS.filter((a) => GEST.has(keyOf(a)))]) {
      const k = keyOf(t);
      if (seen.has(k)) continue;
      if (t.tab === 'cruscotto' && !cfg.finance) continue;
      seen.add(k); gest.push(t);
    }
    const altro = ALL_ACTIONS.filter((t) => !seen.has(keyOf(t)) && (t.tab !== 'cruscotto' || cfg.finance));
    return { quick, gestione: gest, altro };
  }, [cfg]);

  const query = q.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return [];
    const all = [...quick, ...gestione, ...altro];
    const seen = new Set<string>();
    return all.filter((t) => {
      const k = keyOf(t);
      if (seen.has(k) || !t.label.toLowerCase().includes(query)) return false;
      seen.add(k); return true;
    });
  }, [query, quick, gestione, altro]);

  const tile = (t: Tile, i: number, kind: 'q' | 'm') => {
    const [bg, fg] = tileTint(t.icon);
    const b = badge(t.badge);
    return (
      <button key={kind + i} className={kind === 'q' ? 'ds-qbtn' : 'ds-mcard'} type="button" onClick={() => go(t.tab, t.param)}>
        {t.badge && b > 0 ? <span className="ds-bdg">{b}</span> : null}
        <span className={kind === 'q' ? 'qi' : 'mi'} style={{ background: `var(${bg})`, color: `var(${fg})` }}><Icon name={t.icon} /></span>
        <span className={kind === 'q' ? 'ql' : 'ml'}>{t.label}</span>
      </button>
    );
  };

  return (
    <div className="screen">
      <div className="hello">
        <h1>Ciao, {personaName(chi)} 👋</h1>
        <div className="sub">Cosa vuoi fare?</div>
      </div>
      <div style={{ marginBottom: 14 }}><PersonaPicker chi={chi} setChi={setChi} /></div>

      <div className="ds-search">
        <Icon name="search" size={19} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca un'azione…" aria-label="Cerca azione" />
        {q ? <button type="button" onClick={() => setQ('')} className="drawerx" style={{ width: 30, height: 30, fontSize: 13 }} aria-label="Pulisci">✕</button> : null}
      </div>

      {query ? (
        <div className="ds-manage">
          {matches.length ? matches.map((t, i) => tile(t, i, 'm')) : <div className="muted" style={{ gridColumn: '1 / -1', padding: '8px 2px' }}>Nessuna azione trovata.</div>}
        </div>
      ) : (
        <>
          {cfg.finance && fin && (
            <button className="ds-hero" onClick={() => go('cruscotto')} type="button">
              <div>
                <div className="l">Netto {meseNome(nowMonth())}</div>
                <div className="big">{eur(fin.netto)}</div>
                {fin.deltaPct !== null && (
                  <span className="chip">{fin.deltaPct >= 0 ? '▲' : '▼'} {fin.deltaPct >= 0 ? '+' : ''}{fin.deltaPct}% vs {meseNome(nowMonth() - 1)}</span>
                )}
                {fin.spark.length > 1 && (
                  <svg className="spark" width="150" height="26" viewBox="0 0 150 26" preserveAspectRatio="none" aria-hidden="true">
                    <polyline fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" points={sparkPoints(fin.spark)} />
                  </svg>
                )}
              </div>
              <div className="sec">
                <div className="l">Utile (mesi chiusi)</div>
                <div className="big">{eur(fin.mc2)}</div>
              </div>
              <span className="go">Cruscotto ›</span>
            </button>
          )}

          <div className="ds-seclb">Azioni rapide <span className="c">{quick.length}</span></div>
          <div className="ds-quick">{quick.map((t, i) => tile(t, i, 'q'))}</div>

          {gestione.length > 0 && (
            <>
              <div className="ds-seclb">Gestione</div>
              <div className="ds-manage">{gestione.map((t, i) => tile(t, i, 'm'))}</div>
            </>
          )}

          {altro.length > 0 && (
            <section style={{ marginTop: 6 }}>
              <button type="button" className="ds-more" onClick={toggleAll}>
                <span>Altro <span style={{ opacity: .7 }}>({altro.length})</span></span>
                <b>{showAll ? 'Nascondi ▲' : 'Vedi tutte ›'}</b>
              </button>
              {showAll && <div className="ds-manage" style={{ marginTop: 11 }}>{altro.map((t, i) => tile(t, i, 'm'))}</div>}
            </section>
          )}
        </>
      )}

      {cfg.finance && <HealthBanner />}
    </div>
  );
}
