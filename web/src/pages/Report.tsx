import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { syncShopify } from '../lib/api';

const MESI = ['', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const pct = (n: number) => `${Math.round((n || 0) * 100)}%`;

type CE = { year: number; month: number; omni_netto: number; mc1: number; mc2: number; online_netto: number; offline_netto: number; b2b_netto: number; [k: string]: number };
type Inv = { codice: string; item: string | null; variant: string | null; giacenza_attuale: number; valore: number; shopify_sold: number; qromo_sold: number; b2b_venduto: number; retail_price: number | null; cogs: number | null };

export default function Report() {
  const [ce, setCe] = useState<CE[]>([]);
  const [inv, setInv] = useState<Inv[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [detailMonth, setDetailMonth] = useState(5);

  useEffect(() => {
    (async () => {
      try {
        const a = await supabase.from('v_ce_amimi_summary').select('*').order('month');
        const b = await supabase.from('v_inventory').select('codice,item,variant,giacenza_attuale,valore,shopify_sold,qromo_sold,b2b_venduto,retail_price,cogs');
        if (a.error) throw a.error;
        if (b.error) throw b.error;
        setCe((a.data as CE[]).filter((r) => r.year === 2026 && r.month >= 2 && r.month <= 12));
        setInv(b.data as Inv[]);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  async function doSync() {
    const pin = 'x';
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await syncShopify(pin);
      setSyncMsg(`✓ ${r.inserted ? r.inserted + ' nuovi ordini' : 'già aggiornato'}`);
      setReload((x) => x + 1);
    } catch (e) {
      setSyncMsg((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <div className="screen"><p className="muted center">Carico i dati…</p></div>;
  if (err) return <div className="screen"><div className="card err">Errore: {err}</div></div>;

  const closed = ce.filter((r) => r.month >= 2 && r.month <= 5);
  const nettoYtd = ce.reduce((s, r) => s + r.omni_netto, 0);
  const mc1Ytd = closed.reduce((s, r) => s + r.mc1, 0);
  const mc2Ytd = closed.reduce((s, r) => s + r.mc2, 0);
  const valoreMag = inv.reduce((s, r) => s + (r.valore || 0), 0);
  const onY = ce.reduce((s, r) => s + r.online_netto, 0);
  const ofY = ce.reduce((s, r) => s + r.offline_netto, 0);
  const b2bY = ce.reduce((s, r) => s + r.b2b_netto, 0);
  const totCh = onY + ofY + b2bY || 1;
  const top = inv
    .map((p) => ({ ...p, venduto: (p.shopify_sold || 0) + (p.qromo_sold || 0) + (p.b2b_venduto || 0), margine: p.retail_price && p.cogs != null ? (p.retail_price - p.cogs) / p.retail_price : null }))
    .filter((p) => p.venduto > 0).sort((a, b) => b.venduto - a.venduto).slice(0, 12);
  const dm = ce.find((r) => r.month === detailMonth);

  return (
    <div className="screen">
      <header>
        <h1>Amimì · Cruscotto</h1>
        <span className="badge">replica · in validazione</span>
      </header>

      <button className="syncbtn" onClick={doSync} disabled={syncing}>{syncing ? 'Sincronizzo…' : (syncMsg || '🔄 Sincronizza Shopify')}</button>

      <div className="kpis">
        <Kpi label="Fatturato Netto 2026" value={eur(nettoYtd)} tone="rose" />
        <Kpi label="MC1 (feb–mag)" value={eur(mc1Ytd)} tone="green" />
        <Kpi label="MC2 (feb–mag)" value={eur(mc2Ytd)} tone={mc2Ytd >= 0 ? 'green' : 'red'} />
        <Kpi label="Valore magazzino" value={eur(valoreMag)} tone="accent" />
      </div>

      <section className="card">
        <h2>Canali (netto 2026)</h2>
        <div className="bar">
          <div className="seg on" style={{ flex: onY }} />
          <div className="seg of" style={{ flex: ofY }} />
          {b2bY > 0 && <div className="seg b2" style={{ flex: b2bY }} />}
        </div>
        <div className="barleg">
          <span><i className="dot on" />Online {pct(onY / totCh)} · {eur(onY)}</span>
          <span><i className="dot of" />Offline {pct(ofY / totCh)} · {eur(ofY)}</span>
          {b2bY > 0 && <span><i className="dot b2" />B2B {pct(b2bY / totCh)}</span>}
        </div>
      </section>

      <section className="card">
        <h2>Conto Economico mensile</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Mese</th><th>Netto</th><th>MC1</th><th>MC2</th><th>MC2%</th></tr></thead>
            <tbody>
              {ce.map((r) => (
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
        <p className="note">* giugno in corso. Gennaio escluso (ereditato dal P&L precedente). Feb e Mar combaciano col foglio al centesimo; Apr/Mag entro ~1% (in revisione).</p>
      </section>

      <section className="card">
        <div className="dethead">
          <h2>Dettaglio mese</h2>
          <select value={detailMonth} onChange={(e) => setDetailMonth(Number(e.target.value))}>
            {ce.map((r) => <option key={r.month} value={r.month}>{MESI[r.month]}</option>)}
          </select>
        </div>
        {dm && (
          <div>
            <DetRow label="Online netto" v={dm.online_netto} />
            <DetRow label="Offline netto" v={dm.offline_netto} />
            {dm.b2b_netto > 0 && <DetRow label="B2B netto" v={dm.b2b_netto} />}
            <DetRow label="Fatturato netto" v={dm.omni_netto} bold />
            <div className="detsep">Costi variabili</div>
            <DetRow label="COGS" v={dm.cogs} />
            <DetRow label="Packaging" v={dm.packaging} />
            <DetRow label="Commissioni pagamenti" v={dm.commissioni} />
            <DetRow label="Logistica (spedizioni)" v={dm.logistica_var} />
            <DetRow label="Resi" v={dm.resi} />
            <DetRow label="Margine di Contribuzione 1" v={dm.mc1} bold />
            <div className="detsep">Costi fissi</div>
            <DetRow label="Salari" v={dm.salari} />
            <DetRow label="Tasse" v={dm.tasse} />
            <DetRow label="Logistica (magazzino)" v={dm.logistica_mag} />
            <DetRow label="OPEX" v={dm.opex} />
            <DetRow label="Eventi" v={dm.eventi} />
            <DetRow label="Marketing" v={dm.marketing} />
            <DetRow label="MC2 (utile)" v={dm.mc2} bold />
          </div>
        )}
      </section>

      <section className="card">
        <h2>Top prodotti (più venduti)</h2>
        <div className="list">
          {top.map((p) => (
            <div className="row" key={p.codice}>
              <div>
                <div className="rt">{p.item ?? p.codice}</div>
                <div className="rs">{p.variant ?? ''}{p.margine != null ? ` · MdC ${pct(p.margine)}` : ''}</div>
              </div>
              <div className="giac" style={{ color: 'var(--rose)' }}>{p.venduto}</div>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className={`kpi ${tone}`}><div className="v">{value}</div><div className="k">{label}</div></div>;
}
function DetRow({ label, v, bold }: { label: string; v: number; bold?: boolean }) {
  return <div className={`detrow ${bold ? 'b' : ''}`}><span>{label}</span><span className={v < 0 ? 'neg' : ''}>{eur(v)}</span></div>;
}
