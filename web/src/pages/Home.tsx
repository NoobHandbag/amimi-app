import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PERSONA, PersonaPicker, personaName, ALL_ACTIONS } from '../lib/people';
import type { Tab, Tile } from '../lib/people';
import { nowMonth, nowYear, meseNome } from '../lib/helpers';
import Icon from '../components/Icon';
import HealthBanner from '../components/HealthBanner';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);

export default function Home({ chi, setChi, go }: { chi: string; setChi: (c: string) => void; go: (t: Tab, p?: string) => void }) {
  const cfg = PERSONA[chi] ?? PERSONA.Ale;
  const [badges, setBadges] = useState({ arrivi: 0, todo: 0 });
  const [fin, setFin] = useState<{ netto: number; mc2: number } | null>(null);
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
        // only actionable work (nuovi + prezzo/COGS mancanti); the "pulizia" bucket is optional
        todo: (todo.data ?? []).filter((r: { bucket: string }) => r.bucket !== 'pulizia').length,
      });
      if (cfg.finance) {
        const ce = await supabase.from('v_ce_amimi_summary').select('month,omni_netto,mc2').eq('year', nowYear());
        const rows = (ce.data ?? []) as { month: number; omni_netto: number; mc2: number }[];
        const cur = rows.find((r) => r.month === nowMonth());
        const closed = rows.filter((r) => r.month < nowMonth()).reduce((s, r) => s + Number(r.mc2), 0);
        setFin({ netto: cur ? Number(cur.omni_netto) : 0, mc2: closed });
      }
    })();
  }, [chi]);

  const badge = (b?: 'arrivi' | 'todo') => (b === 'arrivi' ? badges.arrivi : b === 'todo' ? badges.todo : 0);

  return (
    <div className="screen">
      <div className="hello">
        <h1>Ciao, {personaName(chi)} 👋</h1>
        <div className="sub">Cosa vuoi fare?</div>
      </div>
      <div style={{ marginBottom: 14 }}><PersonaPicker chi={chi} setChi={setChi} /></div>

      <HealthBanner />


      {cfg.finance && fin && (
        <button className="card homesum" onClick={() => go('cruscotto')} style={{ cursor: 'pointer', width: '100%' }}>
          <div><div className="hsv" style={{ color: 'var(--accent)' }}>{eur(fin.netto)}</div><div className="hsk">Netto {meseNome(nowMonth())}</div></div>
          <div><div className="hsv" style={{ color: fin.mc2 >= 0 ? 'var(--green)' : 'var(--red)' }}>{eur(fin.mc2)}</div><div className="hsk">Utile (mesi chiusi)</div></div>
          <div style={{ marginLeft: 'auto', alignSelf: 'center', color: 'var(--rose)', fontWeight: 700 }}>Cruscotto ›</div>
        </button>
      )}

      <div className="hometiles">
        {cfg.tiles.map((t, i) => (
          <button key={i} className="hometile" onClick={() => go(t.tab, t.param)} type="button">
            {t.badge && badge(t.badge) > 0 ? <span className="hb">{badge(t.badge)}</span> : null}
            <span className="hi"><Icon name={t.icon} size={26} /></span>
            <span className="hl">{t.label}</span>
          </button>
        ))}
      </div>

      {(() => {
        // Tutte le azioni dell'app che NON sono già nei bottoni personali sopra.
        const key = (t: Tile) => `${t.tab}:${t.param ?? ''}`;
        const mine = new Set(cfg.tiles.map(key));
        const others = ALL_ACTIONS.filter((t) => !mine.has(key(t)) && (t.tab !== 'cruscotto' || cfg.finance));
        if (!others.length) return null;
        return (
          <section style={{ marginTop: 18 }}>
            <button type="button" onClick={toggleAll}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', padding: '4px 2px', cursor: 'pointer', color: 'var(--muted, #8a7f84)', fontWeight: 700, fontSize: 14 }}>
              <span>Tutte le azioni</span>
              <span style={{ opacity: .7 }}>{others.length}</span>
              <span style={{ marginLeft: 'auto' }}>{showAll ? '▲' : '▼'}</span>
            </button>
            {showAll && (
              <div className="hometiles" style={{ marginTop: 8 }}>
                {others.map((t, i) => (
                  <button key={i} className="hometile" onClick={() => go(t.tab, t.param)} type="button">
                    {t.badge && badge(t.badge) > 0 ? <span className="hb">{badge(t.badge)}</span> : null}
                    <span className="hi"><Icon name={t.icon} size={26} /></span>
                    <span className="hl">{t.label}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })()}
    </div>
  );
}
