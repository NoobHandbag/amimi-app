import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PERSONA, PersonaPicker, personaName } from '../lib/people';
import type { Tab } from '../lib/people';
import { nowMonth, nowYear, meseNome } from '../lib/helpers';
import Icon from '../components/Icon';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);

export default function Home({ chi, setChi, go }: { chi: string; setChi: (c: string) => void; go: (t: Tab, p?: string) => void }) {
  const cfg = PERSONA[chi] ?? PERSONA.Ale;
  const [badges, setBadges] = useState({ arrivi: 0, todo: 0 });
  const [fin, setFin] = useState<{ netto: number; mc2: number } | null>(null);

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
    </div>
  );
}
