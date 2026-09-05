import { useEffect, useMemo, useState } from 'react';
import {
  fetchCeGrid, fetchDrillExpense, fetchDrillCogs, fetchDrillSales, shopifyOrderUrl,
} from '../lib/api';
import type { CeFull, DrillExp, DrillCogs, DrillSale } from '../lib/api';
import { nowMonth } from '../lib/helpers';
import ExportBtn from '../components/ExportBtn';
import PrintBtn from '../components/PrintBtn';

const MESI = ['', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const CUR = nowMonth();
const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const num = (n: number) => (n || 0).toLocaleString('it-IT');
const pct = (n: number) => `${Math.round((n || 0) * 100)}%`;

type Scope = 'amimi' | 'totale';
type Mode = 'eur' | 'pct' | 'delta';

// una voce di CE: chiave (colonna della vista o derivata), come si comporta, e da dove viene il drill.
type Src =
  | { type: 'exp'; line: string }
  | { type: 'cogs' }
  | { type: 'sales'; field: 'lordo' | 'commissioni' | 'refund' | 'qty' }
  | { type: 'formula' }
  | { type: 'sub' }
  | { type: 'none' };
type RowDef = {
  grp?: string; k?: string; lab?: string; unit?: 'e' | 'n';
  kind?: 'rev' | 'cost' | 'muted'; strong?: boolean; sub?: boolean; mc?: 1 | 2; pctOf?: 'mc1' | 'mc2'; src?: Src;
};

const ROWS: RowDef[] = [
  { grp: 'Ricavi per canale' },
  { k: 'online_pezzi', lab: 'Online · pezzi', unit: 'n', src: { type: 'sales', field: 'qty' } },
  { k: 'online_lordo', lab: 'Online · fatturato lordo', unit: 'e', kind: 'rev', src: { type: 'sales', field: 'lordo' } },
  { k: 'online_netto', lab: 'Online · fatturato netto', unit: 'e', kind: 'rev', src: { type: 'sales', field: 'lordo' } },
  { k: 'offline_pezzi', lab: 'Offline POS · pezzi', unit: 'n', src: { type: 'sales', field: 'qty' } },
  { k: 'offline_lordo', lab: 'Offline · fatturato lordo', unit: 'e', kind: 'rev', src: { type: 'sales', field: 'lordo' } },
  { k: 'offline_netto', lab: 'Offline · fatturato netto', unit: 'e', kind: 'rev', src: { type: 'sales', field: 'lordo' } },
  { k: 'omni_pezzi', lab: 'Omnichannel · pezzi', unit: 'n', strong: true, src: { type: 'none' } },
  { k: 'omni_lordo', lab: 'Omnichannel · lordo', unit: 'e', kind: 'rev', strong: true, src: { type: 'none' } },
  { k: 'omni_netto', lab: 'Fatturato netto', unit: 'e', kind: 'rev', strong: true, sub: true, src: { type: 'none' } },
  { grp: 'Costi variabili' },
  { k: 'cogs', lab: 'COGS', unit: 'e', kind: 'cost', src: { type: 'cogs' } },
  { k: 'packaging', lab: 'Packaging', unit: 'e', kind: 'cost', src: { type: 'formula' } },
  { k: 'commissioni', lab: 'Commissioni pagamenti', unit: 'e', kind: 'cost', src: { type: 'sales', field: 'commissioni' } },
  { k: 'logistica_var', lab: 'Logistica (spedizioni)', unit: 'e', kind: 'cost', src: { type: 'exp', line: 'lvar' } },
  { k: 'resi', lab: 'Resi', unit: 'e', kind: 'cost', src: { type: 'sales', field: 'refund' } },
  { k: 'var_tot', lab: 'Totale costi variabili', unit: 'e', kind: 'cost', sub: true, src: { type: 'sub' } },
  { k: 'mc1', lab: 'MC1 · margine di contribuzione', unit: 'e', mc: 1, src: { type: 'formula' } },
  { k: 'mc1p', lab: 'MC1 % su netto', pctOf: 'mc1' },
  { grp: 'Costi fissi' },
  { k: 'salari', lab: 'Salari', unit: 'e', kind: 'cost', src: { type: 'exp', line: 'sal' } },
  { k: 'tasse', lab: 'Tasse', unit: 'e', kind: 'cost', src: { type: 'exp', line: 'tasse' } },
  { k: 'logistica_mag', lab: 'Logistica (magazzino)', unit: 'e', kind: 'cost', src: { type: 'exp', line: 'lmag' } },
  { k: 'opex', lab: 'OPEX', unit: 'e', kind: 'cost', src: { type: 'exp', line: 'opex' } },
  { k: 'eventi', lab: 'Eventi', unit: 'e', kind: 'cost', src: { type: 'exp', line: 'ev' } },
  { k: 'marketing', lab: 'Marketing', unit: 'e', kind: 'cost', src: { type: 'exp', line: 'mkt' } },
  { k: 'fissi_tot', lab: 'Totale costi fissi', unit: 'e', kind: 'cost', sub: true, src: { type: 'sub' } },
  { k: 'mc2', lab: 'MC2 · utile', unit: 'e', mc: 2, src: { type: 'formula' } },
  { k: 'mc2p', lab: 'MC2 % su netto', pctOf: 'mc2' },
  { grp: 'IVA' },
  { k: 'iva', lab: 'IVA a debito (22%)', unit: 'e', kind: 'muted', src: { type: 'formula' } },
];

function val(r: CeFull, k: string): number {
  switch (k) {
    case 'omni_pezzi': return r.online_pezzi + r.offline_pezzi + r.b2b_pezzi;
    case 'omni_lordo': return Math.round(r.omni_netto * 1.22);
    case 'var_tot': return r.cogs + r.packaging + r.commissioni + r.logistica_var + r.resi;
    case 'fissi_tot': return r.salari + r.tasse + r.logistica_mag + r.opex + r.eventi + r.marketing;
    case 'iva': return r.omni_netto * 0.22;
    default: return (r as unknown as Record<string, number>)[k] ?? 0;
  }
}

type DrillState = { key: string; label: string; month: number; amount: number; loading: boolean; kind: string; note: string; expRows?: DrillExp[]; cogsRows?: DrillCogs[]; saleRows?: DrillSale[]; field?: string };

export default function CeDetail({ onBack }: { onBack?: () => void }) {
  const [scope, setScope] = useState<Scope>('amimi');
  const [mode, setMode] = useState<Mode>('eur');
  const [rows, setRows] = useState<CeFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillState | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchCeGrid(scope)
      .then((d) => { setRows(d.filter((r) => r.month <= CUR)); setErr(null); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [scope]);

  const months = useMemo(() => rows.map((r) => r.month).sort((a, b) => a - b), [rows]);
  const byMonth = useMemo(() => new Map(rows.map((r) => [r.month, r])), [rows]);
  const closed = months.filter((m) => m < CUR);
  const hasB2B = rows.some((r) => r.b2b_netto !== 0 || r.b2b_pezzi !== 0);

  const shown = ROWS.filter((r) => hasB2B || !r.k?.startsWith('b2b'));

  // KPI periodo (mesi chiusi)
  const sum = (k: string) => closed.reduce((s, m) => s + val(byMonth.get(m)!, k), 0);
  const kNetto = sum('omni_netto'), kMc1 = sum('mc1'), kMc2 = sum('mc2'), kFissi = sum('fissi_tot');
  const kMc1p = kNetto ? kMc1 / kNetto : 0;
  const breakeven = kMc1p > 0 && closed.length ? Math.abs(kFissi / closed.length) / kMc1p : 0;

  async function openCell(row: RowDef, month: number) {
    if (!row.k || !row.src || row.src.type === 'none') return;
    const rec = byMonth.get(month)!;
    const amount = val(rec, row.k);
    const base: DrillState = { key: row.k, label: row.lab ?? row.k, month, amount, loading: true, kind: row.src.type, note: '' };
    setDrill(base);
    try {
      if (row.src.type === 'exp') {
        if (scope === 'totale' && row.src.line === 'lvar') {
          setDrill({ ...base, loading: false, kind: 'formula', note: 'Nel CE Totale la logistica variabile arriva dal blocco manuale ereditato dal Foglio (ce_totale_manual), non dalle spese scomponibili. Nella vista Amimì il drilldown mostra le singole spedizioni.' });
          return;
        }
        const r = await fetchDrillExpense(row.src.line, month, scope === 'amimi');
        setDrill({ ...base, loading: false, expRows: r, note: scope === 'amimi' ? 'Spese approvate con flag Amimì, categoria di questa voce.' : 'Tutte le spese approvate della categoria (brand + personali).' });
      } else if (row.src.type === 'cogs') {
        const r = await fetchDrillCogs(month, scope === 'totale');
        setDrill({ ...base, loading: false, cogsRows: r, note: scope === 'totale' ? 'Venduto × costo, tutti i canali (gift inclusi nel Totale). Aggregato per prodotto.' : 'Venduto × costo (online, offline, B2B). Aggregato per prodotto.' });
      } else if (row.src.type === 'sales') {
        const canali = row.k.startsWith('online') || row.src.field === 'commissioni' || row.src.field === 'refund'
          ? ['online']
          : row.k.startsWith('offline')
            ? (scope === 'totale' ? ['offline', 'gift'] : ['offline'])
            : ['online', 'offline', ...(scope === 'totale' ? ['gift'] : []), ...(hasB2B ? ['b2b'] : [])];
        const r = await fetchDrillSales(canali, month);
        setDrill({ ...base, loading: false, saleRows: r, field: row.src.field, note: row.src.field === 'commissioni' ? 'Commissioni di pagamento per ordine online.' : row.src.field === 'refund' ? 'Rimborsi Shopify del mese (netto IVA nel CE). Eventuali resi POS/Qromo e rettifiche manuali non sono qui.' : 'Ordini e scontrini che sommano a questa voce.' });
      } else if (row.src.type === 'sub') {
        setDrill({ ...base, loading: false, kind: 'sub' });
      } else {
        setDrill({ ...base, loading: false, kind: 'formula', note: formulaNote(row.k) });
      }
    } catch (e) {
      setDrill({ ...base, loading: false, note: 'Errore nel caricare il dettaglio: ' + (e instanceof Error ? e.message : String(e)) });
    }
  }

  function formulaNote(k: string): string {
    if (k === 'packaging') return 'Formula, non righe di spesa: 3,71 € × pezzi (online + offline) + 1 € a ordine online. Scala sui pezzi venduti del mese.';
    if (k === 'mc1') return 'MC1 = Fatturato netto − Costi variabili (COGS, packaging, commissioni, logistica, resi). Tocca quelle celle per il dettaglio.';
    if (k === 'mc2') return 'MC2 (utile) = MC1 − Costi fissi (salari, tasse, logistica magazzino, OPEX, eventi, marketing). Tocca quelle celle per il dettaglio.';
    if (k === 'iva') return 'IVA a debito = Lordo − Netto = Netto × 22%. Non è un costo del conto economico, è la quota da versare.';
    return '';
  }

  if (loading) return <div className="screen"><header><h1>CE dettagliato</h1></header><p className="muted center">Carico i dati…</p></div>;
  if (err) return <div className="screen"><header><h1>CE dettagliato</h1></header><div className="card err">Errore: {err}</div></div>;

  return (
    <div className="screen">
      <header>
        <h1>CE dettagliato</h1>
        <div className="operbar">
          <PrintBtn />
          <ExportBtn name={`ce_dettaglio_${scope}`} rows={() => shown.filter((r) => r.k && !r.grp && !r.pctOf).map((r) => {
            const o: Record<string, string | number> = { voce: r.lab! };
            months.forEach((m) => { o[MESI[m]] = Math.round(val(byMonth.get(m)!, r.k!)); });
            return o;
          })} />
        </div>
      </header>
      {onBack && <button className="back" onClick={onBack}>← Home</button>}

      <div className="ctrlbar cedt-ctrl">
        <div className="ds-seg">
          <button type="button" className={scope === 'amimi' ? 'on' : ''} onClick={() => setScope('amimi')}>Amimì</button>
          <button type="button" className={scope === 'totale' ? 'on' : ''} onClick={() => setScope('totale')}>Totale</button>
        </div>
        <div className="ds-seg">
          <button type="button" className={mode === 'eur' ? 'on' : ''} onClick={() => setMode('eur')}>€</button>
          <button type="button" className={mode === 'pct' ? 'on' : ''} onClick={() => setMode('pct')}>% ricavo</button>
          <button type="button" className={mode === 'delta' ? 'on' : ''} onClick={() => setMode('delta')}>Δ mese</button>
        </div>
      </div>

      <div className="kpis">
        <div className="ds-kpi"><div className="v">{eur(kNetto)}</div><div className="l">Fatturato netto</div><div className="s">{closed.length} mesi chiusi</div></div>
        <div className={`ds-kpi ${kMc1 >= 0 ? 'pos' : 'neg'}`}><div className="v">{eur(kMc1)}</div><div className="l">MC1 · margine</div><div className="s">{pct(kMc1p)} su netto {kMc1p >= 0.55 && kMc1p <= 0.8 ? '· in banda' : '· fuori 55–80%'}</div></div>
        <div className="ds-kpi hero"><div className="v">{eur(kMc2)}</div><div className="l">MC2 · utile</div><div className="s">{pct(kNetto ? kMc2 / kNetto : 0)} su netto</div></div>
        <div className="ds-kpi accent"><div className="v">{eur(breakeven)}</div><div className="l">Pareggio / mese</div><div className="s">costi fissi ÷ MC1%</div></div>
      </div>

      <section className="card">
        <h2>Conto Economico mensile</h2>
        <p className="note" style={{ marginTop: -2 }}>Tocca una cella per vedere le righe che la compongono. {mode === 'pct' ? 'Ogni voce come quota del fatturato netto del mese.' : mode === 'delta' ? 'Variazione rispetto al mese precedente.' : 'I costi sono negativi.'}</p>
        <div className="tablewrap cedt-scroll">
          <table className="cedt">
            <thead>
              <tr>
                <th>Voce</th>
                {months.map((m) => <th key={m} className={m === CUR ? 'cur' : ''}>{MESI[m]}{m === CUR ? ' *' : ''}</th>)}
                <th>Anno</th>
                <th className="sparkh">Trend</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                if (r.grp) return <tr key={'g' + i} className="grp"><td className="lab">{r.grp}</td><td colSpan={months.length + 2} /></tr>;
                if (r.pctOf) {
                  const isMc1 = r.pctOf === 'mc1';
                  return (
                    <tr key={r.k} className="pct">
                      <td className="lab">{r.lab}</td>
                      {months.map((m) => {
                        const rec = byMonth.get(m)!; const nv = rec.omni_netto; const p = nv ? val(rec, r.pctOf!) / nv : 0;
                        const out = isMc1 && m < CUR && (p < 0.55 || p > 0.8);
                        return <td key={m} className={out ? 'flag' : ''}>{m === CUR ? '—' : pct(p)}{out ? <span className="dot" /> : ''}</td>;
                      })}
                      <td>{kNetto ? pct(sum(r.pctOf) / kNetto) : '—'}</td>
                      <td />
                    </tr>
                  );
                }
                const cls = [r.mc ? 'mc' + (r.mc === 2 ? ' mc2row' : '') : '', r.sub ? 'sub' : ''].join(' ').trim();
                const vals = months.map((m) => val(byMonth.get(m)!, r.k!));
                const clickable = r.src && r.src.type !== 'none';
                return (
                  <tr key={r.k} className={cls}>
                    <td className="lab">{r.lab}</td>
                    {months.map((m, j) => {
                      const raw = vals[j]; const rec = byMonth.get(m)!;
                      let disp: string;
                      if (r.unit === 'n') disp = mode === 'delta' ? deltaTxt(vals, j, false) : num(raw);
                      else if (mode === 'pct') disp = rec.omni_netto ? pct(raw / rec.omni_netto) : '—';
                      else if (mode === 'delta') disp = deltaTxt(vals, j, true);
                      else disp = raw === 0 ? '—' : eur(raw);
                      if (r.mc && m === CUR) disp = '—';
                      const cellCls = ['val', raw === 0 && mode === 'eur' ? 'z' : '', r.kind === 'cost' && mode === 'eur' && raw !== 0 ? 'cost' : '', m === CUR ? 'curcol' : '', clickable ? 'clk' : ''].join(' ').trim();
                      return <td key={m} className={cellCls} onClick={clickable ? () => openCell(r, m) : undefined} dangerouslySetInnerHTML={{ __html: disp }} />;
                    })}
                    <td className="ytd">{r.unit === 'n' ? num(vals.reduce((s, v) => s + v, 0)) : (r.mc ? eur(sum(r.k!)) : (() => { const t = vals.reduce((s, v) => s + v, 0); return t === 0 ? '—' : eur(t); })())}</td>
                    <td className="spark">{sparkline(vals, r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">
          {scope === 'amimi'
            ? '* mese in corso: costi fissi non ancora completi, MC non definitivi. Vista Amimì (brand): Feb–Mar combaciano col vecchio Foglio al centesimo, Apr/Mag entro ~1%.'
            : '* mese in corso. Vista Totale (intera attività): Gen/Feb includono un blocco manuale ereditato dal Foglio (non scomponibile in drilldown).'}
        </p>
      </section>

      {drill && <Drawer d={drill} scope={scope} onClose={() => setDrill(null)} />}
    </div>
  );
}

function deltaTxt(vals: number[], j: number, isEur: boolean): string {
  if (j <= 0) return '—';
  const d = vals[j] - vals[j - 1];
  if (d === 0) return '±0';
  const cls = d >= 0 ? 'pos' : 'neg';
  const txt = isEur ? eur(Math.abs(d)) : String(Math.abs(d));
  return `<span class="${cls}">${d > 0 ? '+' : '−'}${txt}</span>`;
}

function sparkline(vals: number[], r: RowDef) {
  const n = vals.length; if (!n) return null;
  const mn = Math.min(0, ...vals), mx = Math.max(0, ...vals), rng = (mx - mn) || 1;
  const W = 60, H = 20, pad = 2;
  const x = (i: number) => pad + i * ((W - 2 * pad) / Math.max(1, n - 1));
  const y = (v: number) => H - pad - ((v - mn) / rng) * (H - 2 * pad);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const color = r.mc ? 'var(--positive-700)' : r.kind === 'cost' ? 'var(--sec-cabaret)' : r.kind === 'rev' ? 'var(--interactive)' : 'var(--sec-lavender)';
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <line x1={pad} y1={y(0).toFixed(1)} x2={W - pad} y2={y(0).toFixed(1)} stroke="var(--border-strong)" strokeWidth="1" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1).toFixed(1)} cy={y(vals[n - 1]).toFixed(1)} r="2.1" fill={color} />
    </svg>
  );
}

function Drawer({ d, scope, onClose }: { d: DrillState; scope: Scope; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  const money = (n: number) => eur(n);
  return (
    <>
      <div className="cedt-scrim" onClick={onClose} />
      <aside className="cedt-drawer" role="dialog" aria-label={`Dettaglio ${d.label}`}>
        <div className="cedt-dwhead">
          <button className="cedt-x" onClick={onClose} aria-label="Chiudi">✕</button>
          <div className="eyk">{MESI[d.month]} · {scope === 'amimi' ? 'Amimì' : 'Totale'}</div>
          <h3>{d.label}</h3>
          <div className={`amt ${d.amount < 0 ? 'neg' : d.amount > 0 ? 'pos' : ''}`}>{d.key.endsWith('pezzi') ? num(d.amount) + ' pezzi' : money(d.amount)}</div>
        </div>
        <div className="cedt-dwbody">
          {d.loading && <p className="muted center">Carico il dettaglio…</p>}
          {!d.loading && d.note && <div className="cedt-note">{d.note}</div>}

          {!d.loading && d.expRows && (d.expRows.length ? d.expRows.map((r, i) => (
            <div className="cedt-row" key={i}>
              <div className="di"><div className="dt">{r.operazione || '(senza descrizione)'}</div>
                <div className="dm">{(r.date_paid ?? '').slice(0, 10)}{r.sottocategoria ? ' · ' + r.sottocategoria : ''}{scope === 'totale' && !r.amimi ? ' · personale' : ''}</div></div>
              <div className="dv neg">{money(r.costo)}</div>
            </div>
          )) : <p className="muted center">Nessuna spesa in questo mese.</p>)}

          {!d.loading && d.cogsRows && (d.cogsRows.length ? d.cogsRows.map((r, i) => (
            <div className="cedt-row" key={i}>
              <div className="di"><div className="dt">{r.item ?? r.codice}{r.variant ? ' · ' + r.variant.replace(/_/g, ' ') : ''}</div>
                <div className="dm">{r.canale}{r.qty ? ' · ×' + r.qty : ''}</div></div>
              <div className="dv neg">{money(r.costo)}</div>
            </div>
          )) : <p className="muted center">Nessuna vendita in questo mese.</p>)}

          {!d.loading && d.saleRows && (() => {
            const f = d.field ?? 'lordo';
            const rows = f === 'refund' ? d.saleRows.filter((r) => r.refund !== 0)
              : f === 'commissioni' ? d.saleRows.filter((r) => r.commissioni !== 0)
                : d.saleRows;
            const value = (r: DrillSale) => f === 'refund' ? -r.refund / 1.22 : f === 'commissioni' ? r.commissioni : r.lordo;
            const sorted = [...rows].sort((a, b) => Math.abs(value(b)) - Math.abs(value(a)));
            if (!sorted.length) return <p className="muted center">Nessuna riga in questo mese.</p>;
            return sorted.map((r, i) => {
              const url = r.canale === 'online' ? shopifyOrderUrl(r.ref) : undefined;
              const v = value(r);
              return (
                <div className="cedt-row" key={i}>
                  <div className="di"><div className="dt">{r.descr || (r.canale === 'offline' ? 'Vendita negozio' : r.canale === 'b2b' ? 'B2B' : 'Ordine')}</div>
                    <div className="dm">{(r.data ?? '').slice(0, 10)} · {r.canale}{r.is_gift ? ' · gift' : ''}{r.ref && r.canale === 'online' ? ' · #' + r.ref : ''}{url ? ' ↗' : ''}</div></div>
                  <div className={`dv ${v < 0 ? 'neg' : ''}`}>{f === 'qty' ? num(r.qty ?? 0) : money(v)}</div>
                  {url && <a className="cedt-link" href={url} target="_blank" rel="noreferrer" aria-label="Apri in Shopify" />}
                </div>
              );
            });
          })()}
        </div>
      </aside>
    </>
  );
}
