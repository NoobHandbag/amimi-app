import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { syncShopify, fetchCeTotale, fetchAdsMensile } from '../lib/api';
import type { CeTot, AdsMese, Product } from '../lib/api';
import ProductPicker from '../components/ProductPicker';
import { useSort } from '../lib/sortable';
import ExportBtn from '../components/ExportBtn';
import PrintBtn from '../components/PrintBtn';
import Icon from '../components/Icon';
import { nowMonth, nowYear } from '../lib/helpers';

const MESI = ['', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const pct = (n: number) => `${Math.round((n || 0) * 100)}%`;
const pct1 = (n: number) => `${((n || 0) * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`;

type CE = { year: number; month: number; omni_netto: number; mc1: number; mc2: number; online_netto: number; offline_netto: number; b2b_netto: number; [k: string]: number };
type Inv = { codice: string; item: string | null; variant: string | null; shopify_sold: number; qromo_sold: number; b2b_venduto: number; retail_price: number | null; cogs: number | null };
type Scope = 'amimi' | 'totale';
type Row = { month: number; netto: number; lordo: number; mc1: number; mc2: number; online: number; offline: number; b2b: number };

const CURRENT_MONTH = nowMonth(); // mese in corso, derivato dalla data (mai hardcoded)

export default function Report({ onBack }: { onBack?: () => void }) {
  const [ce, setCe] = useState<CE[]>([]);
  const [cet, setCet] = useState<CeTot[]>([]);
  const [inv, setInv] = useState<Inv[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [detailMonth, setDetailMonth] = useState(Math.max(2, CURRENT_MONTH - 1));
  const [scope, setScope] = useState<Scope>('amimi');
  const [sel, setSel] = useState<Set<number>>(new Set(Array.from({ length: CURRENT_MONTH }, (_, i) => i + 1)));

  useEffect(() => {
    (async () => {
      try {
        const a = await supabase.from('v_ce_amimi_summary').select('*').order('month');
        const b = await supabase.from('v_inventory').select('codice,item,variant,shopify_sold,qromo_sold,b2b_venduto,retail_price,cogs');
        const c = await fetchCeTotale();
        if (a.error) throw a.error;
        if (b.error) throw b.error;
        setCe((a.data as CE[]).filter((r) => r.year === nowYear() && r.month >= 1 && r.month <= 12));
        setInv(b.data as Inv[]);
        setCet(c);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  // Unified monthly rows for the active scope
  const rows: Row[] = useMemo(() => {
    if (scope === 'totale') {
      return cet.map((r) => ({ month: r.month, netto: r.netto, lordo: r.lordo, mc1: r.mc1, mc2: r.mc2, online: r.online_netto, offline: r.offline_netto, b2b: r.b2b_netto }));
    }
    return ce.map((r) => ({ month: r.month, netto: r.omni_netto, lordo: r.omni_netto * 1.22, mc1: r.mc1, mc2: r.mc2, online: r.online_netto, offline: r.offline_netto, b2b: r.b2b_netto }));
  }, [scope, ce, cet]);

  const ceSort = useSort(rows as unknown as Record<string, unknown>[], 'month');

  async function doSync() {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await syncShopify('x');
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

  const visMonths = rows.map((r) => r.month).filter((m) => m <= CURRENT_MONTH && (scope === 'totale' || m >= 2));
  const picked = rows.filter((r) => sel.has(r.month));
  const lordo = picked.reduce((s, r) => s + r.lordo, 0);
  const netto = picked.reduce((s, r) => s + r.netto, 0);
  // MC are only meaningful for closed months (giugno in corso has no fixed costs yet)
  const closedPick = picked.filter((r) => r.month < CURRENT_MONTH);
  const mc1 = closedPick.reduce((s, r) => s + r.mc1, 0);
  const mc2 = closedPick.reduce((s, r) => s + r.mc2, 0);
  const nettoClosed = closedPick.reduce((s, r) => s + r.netto, 0) || 1;

  const onY = picked.reduce((s, r) => s + r.online, 0);
  const ofY = picked.reduce((s, r) => s + r.offline, 0);
  const b2bY = picked.reduce((s, r) => s + r.b2b, 0);
  const totCh = onY + ofY + b2bY || 1;
  const maxLordo = Math.max(...visMonths.map((m) => rows.find((r) => r.month === m)!.lordo), 1);

  const top = inv
    .map((p) => ({ ...p, venduto: (p.shopify_sold || 0) + (p.qromo_sold || 0) + (p.b2b_venduto || 0), margine: p.retail_price && p.cogs != null ? (p.retail_price - p.cogs) / p.retail_price : null }))
    .filter((p) => p.venduto > 0).sort((a, b) => b.venduto - a.venduto).slice(0, 12);
  const dm = ce.find((r) => r.month === detailMonth);

  function toggle(m: number) {
    setSel((prev) => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n.size ? n : prev; });
  }
  const allOn = visMonths.every((m) => sel.has(m));

  return (
    <div className="screen">
      <header>
        <h1>Amimì · Cruscotto</h1>
        <div className="operbar">
          <PrintBtn />
          <ExportBtn name="conto_economico" rows={() => rows.map((r) => ({ mese: MESI[r.month], netto: Math.round(r.netto), lordo: Math.round(r.lordo), mc1: Math.round(r.mc1), mc2: Math.round(r.mc2), online: Math.round(r.online), offline: Math.round(r.offline), b2b: Math.round(r.b2b) }))} />
          <span className="badge">replica</span>
        </div>
      </header>
      {onBack && <button className="back" onClick={onBack}>← Home</button>}

      <button className="ds-btn secondary full" style={{ marginBottom: 14 }} onClick={doSync} disabled={syncing}>
        <Icon name="recycle" size={18} />{syncing ? 'Sincronizzo…' : (syncMsg || 'Sincronizza Shopify')}
      </button>

      <div className="ctrlbar">
        <div className="ds-seg">
          <button type="button" className={scope === 'amimi' ? 'on' : ''} onClick={() => setScope('amimi')}>Amimì</button>
          <button type="button" className={scope === 'totale' ? 'on' : ''} onClick={() => setScope('totale')}>Totale</button>
        </div>
        <div className="chips">
          <button type="button" className={`ds-fp ${allOn ? 'on' : ''}`} onClick={() => setSel(new Set(allOn ? [CURRENT_MONTH] : visMonths))}>Tutti</button>
          {visMonths.map((m) => (
            <button key={m} type="button" className={`ds-fp ${sel.has(m) ? 'on' : ''}`} onClick={() => toggle(m)}>{MESI[m]}</button>
          ))}
        </div>
      </div>

      <div className="kpis">
        <div className="ds-kpi accent"><div className="v">{eur(lordo)}</div><div className="l">Fatturato lordo</div><div className="s">incl. IVA</div></div>
        <div className="ds-kpi"><div className="v">{eur(netto)}</div><div className="l">Fatturato netto</div><div className="s">IVA 22% esclusa</div></div>
        <div className={`ds-kpi ${mc1 >= 0 ? 'pos' : 'neg'}`}><div className="v">{eur(mc1)}</div><div className="l">MC1 · margine</div><div className="s">{pct1(mc1 / nettoClosed)} su netto · mesi chiusi</div></div>
        <div className="ds-kpi hero"><div className="v">{eur(mc2)}</div><div className="l">MC2 · Utile</div><div className="s">{pct1(mc2 / nettoClosed)} su netto · mesi chiusi</div></div>
      </div>

      {lordo > 0 && (
        <section className="card ds-funnel">
          <h2>Dal lordo all'utile</h2>
          <p className="note" style={{ marginTop: -4, marginBottom: 12 }}>Dove se ne va il valore, dai ricavi ai costi. MC su mesi chiusi.</p>
          {funnelRow('Fatturato lordo', null, lordo, lordo, 'var(--grad-action)')}
          {funnelRow('Fatturato netto', 'meno IVA', netto, lordo, 'var(--interactive)')}
          {funnelRow('MC1', 'meno costi variabili', mc1, lordo, 'var(--sec-lavender)')}
          {funnelRow('MC2 · Utile', 'meno costi fissi', mc2, lordo, 'var(--sec-cabaret)')}
        </section>
      )}

      <section className="card">
        <h2>Trend fatturato lordo mensile</h2>
        <div className="ds-trend">
          {visMonths.map((m) => {
            const r = rows.find((x) => x.month === m)!;
            const on = sel.has(m);
            const h = (r.lordo / maxLordo) * 100;
            const cur = m === CURRENT_MONTH;
            return (
              <button key={m} type="button" className={`ds-tcol ${on ? '' : 'off'}`} onClick={() => toggle(m)} title={`${MESI[m]} · ${eur(r.lordo)}`}>
                <div className="ds-tbarwrap">
                  <span className="ds-tval" style={{ bottom: `${h}%` }}>{r.lordo >= 1000 ? Math.round(r.lordo / 1000) + 'k' : Math.round(r.lordo)}</span>
                  <div className={`ds-tbar ${cur ? 'cur' : ''}`} style={{ height: `${h}%` }} />
                </div>
                <span className="ds-tlabel">{MESI[m]}{cur ? '*' : ''}</span>
              </button>
            );
          })}
        </div>
        <p className="note">Barre viola = fatturato lordo per mese, corallo = mese in corso. Tocca un mese per includerlo o escluderlo dai totali.</p>
      </section>

      <section className="card">
        <h2>Canali · periodo selezionato</h2>
        <div className="ds-chbar">
          <div className="ds-ch-on" style={{ flex: onY }} />
          <div className="ds-ch-of" style={{ flex: ofY }} />
          {b2bY > 0 && <div className="ds-ch-b2" style={{ flex: b2bY }} />}
        </div>
        <div className="ds-chleg">
          <span><i className="ds-ch-on" />Online {pct(onY / totCh)} · {eur(onY)}</span>
          <span><i className="ds-ch-of" />Offline {pct(ofY / totCh)} · {eur(ofY)}</span>
          {b2bY > 0 && <span><i className="ds-ch-b2" />B2B {pct(b2bY / totCh)} · {eur(b2bY)}</span>}
        </div>
      </section>

      <section className="card">
        <h2>Conto Economico mensile</h2>
        <div className="tablewrap">
          <table className="sortable">
            <thead><tr>
              <th onClick={() => ceSort.toggle('month')}>Mese{ceSort.arrow('month')}</th>
              <th onClick={() => ceSort.toggle('netto')}>Netto{ceSort.arrow('netto')}</th>
              <th onClick={() => ceSort.toggle('mc1')}>MC1{ceSort.arrow('mc1')}</th>
              <th>MC1%</th>
              <th onClick={() => ceSort.toggle('mc2')}>MC2{ceSort.arrow('mc2')}</th>
              <th>MC2%</th>
            </tr></thead>
            <tbody>
              {(ceSort.sorted as unknown as Row[]).filter((r) => scope === 'totale' || r.month >= 2).map((r) => (
                <tr key={r.month} className={sel.has(r.month) ? '' : 'dim'}>
                  <td className="l">{MESI[r.month]}{r.month === CURRENT_MONTH ? ' *' : ''}</td>
                  <td>{eur(r.netto)}</td>
                  <td className={r.month < CURRENT_MONTH ? (r.mc1 > 0 ? 'pos' : r.mc1 < 0 ? 'neg' : '') : ''}>{r.month < CURRENT_MONTH ? eur(r.mc1) : '—'}</td>
                  <td>{r.month < CURRENT_MONTH && r.netto ? pct(r.mc1 / r.netto) : '—'}</td>
                  <td className={r.month < CURRENT_MONTH ? (r.mc2 > 0 ? 'pos' : r.mc2 < 0 ? 'neg' : '') : ''}>{r.month < CURRENT_MONTH ? eur(r.mc2) : '—'}</td>
                  <td>{r.month < CURRENT_MONTH && r.netto ? pct(r.mc2 / r.netto) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          {scope === 'amimi'
            ? '* mese in corso (costi fissi non ancora caricati). Vista Amimì (brand): Feb e Mar combaciano col foglio al centesimo, Apr/Mag entro ~1%.'
            : '* mese in corso. Vista Totale (intera attività): valori letti dal foglio CE_TOTALE, gennaio incluso. Non ricalcolati dalle transazioni della replica.'}
        </p>
      </section>

      {scope === 'amimi' && (
        <section className="card">
          <div className="dethead">
            <h2>Dettaglio mese</h2>
            <select value={detailMonth} onChange={(e) => setDetailMonth(Number(e.target.value))}>
              {ce.filter((r) => r.month >= 2).map((r) => <option key={r.month} value={r.month}>{MESI[r.month]}</option>)}
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
      )}

      <section className="card">
        <h2>Top prodotti (più venduti)</h2>
        <div className="list">
          {top.map((p) => (
            <div className="row" key={p.codice}>
              <div>
                <div className="rt">{p.item ?? p.codice}</div>
                <div className="rs">{(p.variant ?? '').replace(/_/g, ' ')}{p.margine != null ? ` · MdC ${pct(p.margine)}` : ''}</div>
              </div>
              <div className="giac" style={{ color: 'var(--rose)' }}>{p.venduto}</div>
            </div>
          ))}
        </div>
      </section>

      <AdsCard />
      <DealCalc />
    </div>
  );
}

function AdsCard() {
  const [ads, setAds] = useState<AdsMese[] | null>(null);
  useEffect(() => { fetchAdsMensile().then(setAds).catch(() => setAds([])); }, []);
  const aSort = useSort((ads ?? []) as unknown as Record<string, unknown>[], 'month');
  if (!ads || !ads.length) return null;
  const spend = ads.reduce((s, r) => s + Number(r.spend), 0);
  const val = ads.reduce((s, r) => s + Number(r.purchase_value), 0);
  const purch = ads.reduce((s, r) => s + Number(r.purchases), 0);
  const roas = spend > 0 ? val / spend : 0;
  return (
    <section className="card">
      <h2>Meta Ads 2026</h2>
      <div className="kpis">
        <Kpi label="Spesa ads" value={eur(spend)} tone="accent" />
        <Kpi label="ROAS" value={roas.toFixed(2) + '×'} tone={roas >= 1 ? 'green' : 'red'} />
      </div>
      <div className="tablewrap"><table className="sortable">
        <thead><tr>
          <th onClick={() => aSort.toggle('month')}>Mese{aSort.arrow('month')}</th>
          <th onClick={() => aSort.toggle('spend')}>Spesa{aSort.arrow('spend')}</th>
          <th onClick={() => aSort.toggle('purchases')}>Acquisti{aSort.arrow('purchases')}</th>
          <th onClick={() => aSort.toggle('purchase_value')}>Valore{aSort.arrow('purchase_value')}</th>
          <th onClick={() => aSort.toggle('roas')}>ROAS{aSort.arrow('roas')}</th>
        </tr></thead>
        <tbody>{(aSort.sorted as unknown as AdsMese[]).map((r) => (
          <tr key={r.month}><td className="l">{MESI[r.month]}</td><td>{eur(Number(r.spend))}</td><td>{r.purchases}</td>
            <td>{eur(Number(r.purchase_value))}</td><td className={Number(r.roas) < 1 ? 'neg' : ''}>{Number(r.roas).toFixed(2)}×</td></tr>
        ))}</tbody>
      </table></div>
      <p className="note">Totale {purch} acquisti attribuiti agli ads. ROAS = valore acquisti ÷ spesa.</p>
    </section>
  );
}

type DealLine = { p: Product; qty: number; sellin: string };
function DealCalc() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<DealLine[]>([]);
  const [picking, setPicking] = useState(false);
  const [storePct, setStorePct] = useState('30');
  const add = (p: Product | null) => { if (p && !lines.some((l) => l.p.codice === p.codice)) setLines((x) => [...x, { p, qty: 5, sellin: p.retail_price ? String(Math.round(p.retail_price / 1.22 * 0.5)) : '' }]); setPicking(false); };

  const tot = lines.reduce((a, l) => {
    const cogs = (l.p.cogs || 0) * l.qty; const ric = Number(l.sellin || 0) * l.qty;
    return { cogs: a.cogs + cogs, ric: a.ric + ric, prof: a.prof + (ric - cogs) };
  }, { cogs: 0, ric: 0, prof: 0 });
  const sp = Number(storePct) / 100;

  return (
    <section className="card ask">
      <button className="askhead" onClick={() => setOpen((o) => !o)}>🧮 Calcolatore offerte B2B <span className="muted">{open ? '−' : '+'}</span></button>
      {open && (
        <div className="askbody">
          {picking ? <ProductPicker selected={null} onPick={add} /> : <button className="bigadd" onClick={() => setPicking(true)}>+ Aggiungi prodotto</button>}
          {lines.map((l, i) => {
            const cogs = l.p.cogs || 0; const sellin = Number(l.sellin || 0);
            const mWhole = sellin > 0 ? (sellin - cogs) / sellin : 0;
            const cvNet = (l.p.retail_price || 0) / 1.22 * (1 - sp); // conto-vendita net to Amimì
            return (
              <div className="cartrow" key={l.p.codice}>
                <div className="cartinfo"><div className="rt">{l.p.item ?? l.p.codice}</div>
                  <div className="rs">COGS €{cogs} · whole {Math.round(mWhole * 100)}% · c/vendita €{cvNet.toFixed(0)}/pz</div></div>
                <input className="qbox" type="number" value={l.qty} onChange={(e) => setLines((x) => x.map((y, j) => j === i ? { ...y, qty: Number(e.target.value) } : y))} />
                <input className="cbox" type="number" placeholder="€/pz" value={l.sellin} onChange={(e) => setLines((x) => x.map((y, j) => j === i ? { ...y, sellin: e.target.value } : y))} />
                <button className="x" onClick={() => setLines((x) => x.filter((_, j) => j !== i))}>✕</button>
              </div>
            );
          })}
          {lines.length > 0 && (
            <>
              <div className="dealrow"><span>% al negozio (conto vendita)</span><input className="qbox" type="number" value={storePct} onChange={(e) => setStorePct(e.target.value)} /></div>
              <div className="detrow b"><span>Wholesale: ricavo</span><span>{eur(tot.ric)}</span></div>
              <div className="detrow"><span>COGS totale</span><span>{eur(tot.cogs)}</span></div>
              <div className="detrow b"><span>Profitto wholesale</span><span className={tot.prof < 0 ? 'neg' : ''}>{eur(tot.prof)} · {tot.ric ? Math.round(tot.prof / tot.ric * 100) : 0}%</span></div>
              <p className="note">Confronto: in conto-vendita Amimì incassa il prezzo retail netto IVA meno il {storePct}% al negozio, solo sul venduto. Wholesale = incassi subito al prezzo €/pz inserito.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return <div className={`kpi ${tone}`}><div className="v">{value}</div><div className="k">{label}</div>{sub && <div className="ksub">{sub}</div>}</div>;
}
function DetRow({ label, v, bold }: { label: string; v: number; bold?: boolean }) {
  return <div className={`detrow ${bold ? 'b' : ''}`}><span>{label}</span><span className={v < 0 ? 'neg' : ''}>{eur(v)}</span></div>;
}
function funnelRow(name: string, sub: string | null, val: number, base: number, color: string) {
  const w = base > 0 ? Math.max(0, Math.min(100, (val / base) * 100)) : 0;
  return (
    <div className="fb" key={name}>
      <div className="fname">{name}{sub && <small>{sub}</small>}</div>
      <div className="ftrack"><div className="ffill" style={{ width: `${w.toFixed(0)}%`, background: color }} /></div>
      <div className="fval">{eur(val)} · {Math.round(w)}%</div>
    </div>
  );
}

// The old inline "Chiedi ai dati" panel here was superseded by the global AssistantPanel
// ("Chiedi ad Amimì", FLOW 6 v2): a slide-in overlay present on every screen, gated by ai_enabled.
