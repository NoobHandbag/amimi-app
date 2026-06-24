import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';

const MESI = ['', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const pct = (n: number) => `${Math.round((n || 0) * 100)}%`;

type CE = { year: number; month: number; omni_netto: number; mc1: number; mc2: number; };
type Inv = { codice: string; item: string | null; variant: string | null; giacenza_attuale: number; valore: number; };

export default function App() {
  const [ce, setCe] = useState<CE[]>([]);
  const [inv, setInv] = useState<Inv[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const a = await supabase.from('v_ce_amimi_summary').select('year,month,omni_netto,mc1,mc2').order('month');
        const b = await supabase.from('v_inventory').select('codice,item,variant,giacenza_attuale,valore');
        if (a.error) throw a.error;
        if (b.error) throw b.error;
        setCe((a.data as CE[]).filter(r => r.year === 2026 && r.month >= 1 && r.month <= 12));
        setInv(b.data as Inv[]);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="screen"><p className="muted center">Carico i dati…</p></div>;
  if (err) return <div className="screen"><div className="card err">Errore: {err}</div></div>;

  const closed = ce.filter(r => r.month >= 2 && r.month <= 5);
  const nettoYtd = ce.reduce((s, r) => s + r.omni_netto, 0);
  const mc1Ytd = closed.reduce((s, r) => s + r.mc1, 0);
  const mc2Ytd = closed.reduce((s, r) => s + r.mc2, 0);
  const valoreMag = inv.reduce((s, r) => s + (r.valore || 0), 0);
  const sottoScorta = inv.filter(r => r.giacenza_attuale <= 2 && r.giacenza_attuale > -50);
  const daRiordinare = inv.filter(r => r.giacenza_attuale <= 3).sort((x, y) => x.giacenza_attuale - y.giacenza_attuale).slice(0, 20);

  return (
    <div className="screen">
      <header>
        <h1>Amimì · Cruscotto</h1>
        <span className="badge">replica · in validazione</span>
      </header>

      <div className="kpis">
        <Kpi label="Fatturato Netto 2026" value={eur(nettoYtd)} tone="rose" />
        <Kpi label="MC1 (feb–mag)" value={eur(mc1Ytd)} tone="green" />
        <Kpi label="MC2 (feb–mag)" value={eur(mc2Ytd)} tone={mc2Ytd >= 0 ? 'green' : 'red'} />
        <Kpi label="Valore magazzino" value={eur(valoreMag)} tone="accent" />
      </div>

      <section className="card">
        <h2>Conto Economico mensile</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Mese</th><th>Netto</th><th>MC1</th><th>MC2</th><th>MC2%</th></tr></thead>
            <tbody>
              {ce.map(r => (
                <tr key={r.month}>
                  <td className="l">{MESI[r.month]}{r.month === 6 ? ' *' : ''}</td>
                  <td>{eur(r.omni_netto)}</td>
                  <td>{eur(r.mc1)}</td>
                  <td className={r.mc2 < 0 ? 'neg' : ''}>{eur(r.mc2)}</td>
                  <td>{r.omni_netto ? pct(r.mc2 / r.omni_netto) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">* giugno in corso (costi non ancora imputati). Feb e Mar combaciano col foglio al centesimo; Apr/Mag entro ~1% (in revisione).</p>
      </section>

      <section className="card">
        <h2>Inventario · da riordinare</h2>
        <div className="minis">
          <Mini n={inv.length} l="prodotti" />
          <Mini n={sottoScorta.length} l="sotto scorta" tone="red" />
          <Mini n={daRiordinare.length} l="da riordinare" tone="accent" />
        </div>
        <div className="list">
          {daRiordinare.map(r => (
            <div className="row" key={r.codice}>
              <div>
                <div className="rt">{r.item || r.codice}</div>
                <div className="rs">{r.variant || ''}</div>
              </div>
              <div className={`giac ${r.giacenza_attuale <= 0 ? 'neg' : ''}`}>{r.giacenza_attuale}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="muted center">Dati da replica isolata · nessuna scrittura ai sistemi live</footer>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className={`kpi ${tone}`}><div className="v">{value}</div><div className="k">{label}</div></div>;
}
function Mini({ n, l, tone }: { n: number; l: string; tone?: string }) {
  return <div className={`mini ${tone || ''}`}><div className="mn">{n}</div><div className="ml">{l}</div></div>;
}
