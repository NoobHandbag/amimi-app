import { useEffect, useMemo, useState } from 'react';
import { fetchRecent, fetchActivityDigest } from '../lib/api';
import type { Activity } from '../lib/api';
import Icon from './Icon';

// Feed "chi ha fatto cosa quando" dal change_log — riga-attività (avatar persona + azione + tag + ora),
// senza emoji (redesign GEEIQ). Filtri per persona e per tipo. Sola lettura.

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);
const CHI: Record<string, string> = { 'qromo-forward': 'Qromo', 'shopify-sync': 'Shopify', cron: 'Automatico', claude: 'Assistente', Bene: 'Benny', Ginevra: 'Ginni' };
const AUTO = new Set(['qromo-forward', 'shopify-sync', 'cron', 'claude', 'ce-guard']);

function avatar(chi: string | null): { i: string; bg: string; name: string } {
  const c = chi ?? '';
  const name = CHI[c] ?? (c || '—');
  if (AUTO.has(c)) return { i: '•', bg: 'var(--ink-muted)', name };
  const k = c.toLowerCase();
  if (k.startsWith('bene') || k.startsWith('benny')) return { i: 'B', bg: 'var(--positive)', name: 'Benny' };
  if (k.startsWith('gin')) return { i: 'G', bg: 'var(--sec-cabaret)', name: 'Ginni' };
  if (k.startsWith('ale') || k.startsWith('dan')) return { i: 'A', bg: 'var(--interactive)', name: 'Ale' };
  return { i: (c || '?').slice(0, 1).toUpperCase(), bg: 'var(--sec-lavender)', name };
}

const VERB: Record<string, string> = {
  close_month: 'Chiusura mese', stock_autopush: 'Stock → Shopify (auto)', shopify_realign: 'Stock → Shopify',
  stock_sync_now: 'Sync Shopify', expense_approve: 'Spesa verificata', expense_propose: 'Spesa proposta', expense_manual: 'Spesa',
  count_apply: 'Conta', product_verify: 'Prodotto verificato', order_multi: 'Ordine fornitore',
  arrival: 'Arrivo merce', arrival_set: 'Arrivo corretto', test_cleanup: 'Pulizia dati test',
  orphan_cleanup: 'Pulizia anagrafica', sale_correct: 'Vendita ri-mappata', guard_fix: 'Fix della guardia',
  qromo_sale: 'Vendita Qromo', gift: 'Regalo', return: 'Reso', product_delete: 'Prodotto rimosso',
};
const TBLVERB: Record<string, string> = {
  purchases: 'Arrivo', counts: 'Conta', gifts_offline: 'Regalo', b2b_movements: 'Movimento B2B', products: 'Prodotto',
  supplier_orders: 'Ordine fornitore', expenses: 'Spesa', returns: 'Reso', qromo_sales: 'Vendita Qromo',
  shopify_orders: 'Ordine online', ce_snapshots: 'Chiusura mese', shopify_stock: 'Stock Shopify', stock_adjustments: 'Rettifica stock',
};
const verbOf = (r: Activity) => (r.op && VERB[r.op]) || TBLVERB[r.tbl] || r.tbl.replace(/_/g, ' ');

const TAG: Record<string, string> = {
  qromo_sales: 'vendite', shopify_orders: 'vendite', gifts_offline: 'vendite', b2b_movements: 'vendite',
  expenses: 'spese', purchases: 'magazzino', counts: 'magazzino', stock_adjustments: 'magazzino',
  supplier_orders: 'ordini', shopify_stock: 'magazzino', products: 'catalogo', returns: 'resi', ce_snapshots: 'contabilità',
};
const tagOf = (r: Activity) => TAG[r.tbl] ?? 'sistema';

function ago(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'ora';
  if (s < 3600) return `${Math.floor(s / 60)}m fa`;
  if (s < 86400) return `${Math.floor(s / 3600)}h fa`;
  return `${Math.floor(s / 86400)}g fa`;
}

function summarize(r: Activity): string {
  const a = (r.after ?? {}) as Record<string, unknown>;
  const n = (k: string) => (a[k] != null ? Number(a[k]) : null);
  const s = (k: string) => (a[k] != null ? String(a[k]) : null);
  switch (r.op) {
    case 'close_month': return `CE ${r.rowId ?? ''} congelato`;
    case 'stock_autopush': return `${n('pushed') ?? 0} aggiornati, ${n('held') ?? 0} in attesa`;
    case 'expense_approve': return [s('categoria'), s('note')?.slice(0, 50)].filter(Boolean).join(' · ');
    case 'expense_manual': case 'expense_propose': return [s('operazione')?.slice(0, 34), n('costo') != null ? eur(Math.abs(n('costo')!)) : null].filter(Boolean).join(' · ');
    case 'count_apply': return `${s('codice') ?? ''}: contati ${n('contati') ?? '?'}`;
    case 'order_multi': return `${s('fornitore') ?? ''} · ${n('righe') ?? '?'} righe`;
    case 'arrival': case 'arrival_set': return `${s('codice') ?? ''} · ${n('qty') ?? n('target') ?? '?'} pz`;
    case 'qromo_sale': return `${s('codice') ?? ''} × ${n('qty') ?? 1}`;
    case 'sale_correct': return `${s('from') ?? ''} → ${s('to') ?? ''}`;
    default: {
      const codice = s('codice'); const qty = n('quantita'); const costo = n('costo');
      return [codice, qty != null ? `× ${qty}` : null, costo != null ? eur(Math.abs(costo)) : null].filter(Boolean).join(' ');
    }
  }
}

const PERSONE = [['', 'Tutti'], ['Ale', 'Ale'], ['Bene', 'Benny'], ['Ginevra', 'Ginni']] as const;
const TIPI = ['vendite', 'spese', 'magazzino', 'ordini'];

type Digest = { text: string; at: string };

export default function ActivityFeed({ pin = 'x' }: { pin?: string }) {
  const [rows, setRows] = useState<Activity[]>([]);
  const [who, setWho] = useState('');
  const [tipo, setTipo] = useState('');
  const [sum, setSum] = useState<Digest | null>(() => {
    try { const c = JSON.parse(localStorage.getItem('amimi_actdigest') || 'null'); return c?.text ? c : null; } catch { return null; }
  });
  const [sumBusy, setSumBusy] = useState(false);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [sumHidden, setSumHidden] = useState(false);
  useEffect(() => { fetchRecent().then(setRows).catch(() => {}); }, []);

  async function genSummary() {
    setSumBusy(true); setSumErr(null);
    try {
      const r = await fetchActivityDigest(pin);
      if (r.needs_key) { setSumHidden(true); return; }
      if (r.error) { setSumErr(/429|quota/i.test(r.error) ? 'Quota AI esaurita per oggi, riprova più tardi.' : r.error); return; }
      if (r.summary) { const rec = { text: r.summary, at: r.generated_at ?? new Date().toISOString() }; setSum(rec); localStorage.setItem('amimi_actdigest', JSON.stringify(rec)); }
    } catch (e) { setSumErr((e as Error).message); } finally { setSumBusy(false); }
  }

  const shown = useMemo(() => rows.filter((r) => {
    if (tipo && tagOf(r) !== tipo) return false;
    if (!who) return true;
    const a = avatar(r.chi);
    return a.name.toLowerCase().startsWith(who.toLowerCase()) || (who === 'Ale' && a.name === 'Ale');
  }), [rows, who, tipo]);

  if (!rows.length) return null;
  return (
    <section className="card">
      <h2>Attività recente</h2>

      {!sumHidden && (
        <div className="ds-aisum">
          <div className="ds-aisum-h">
            <Icon name="sparkles" size={13} /><span>Riepilogo Amimì</span>
            <span className="badge2">Gemini</span>
            {sum && <button type="button" onClick={genSummary} disabled={sumBusy}>{sumBusy ? '…' : 'Rigenera'}</button>}
          </div>
          {sum ? (
            <>
              <p>{sum.text}</p>
              <div style={{ fontSize: 10.5, color: 'var(--ink-muted)', marginTop: 6 }}>Aggiornato {ago(sum.at)}</div>
            </>
          ) : sumErr ? (
            <p style={{ fontSize: 12.5, color: 'var(--negative-700)' }}>{sumErr} <button type="button" className="linkbtn" onClick={genSummary} style={{ color: 'var(--interactive-700)', fontWeight: 700 }}>Riprova</button></p>
          ) : (
            <button type="button" className="ds-btn secondary sm" onClick={genSummary} disabled={sumBusy}>{sumBusy ? 'Genero…' : 'Genera riepilogo attività'}</button>
          )}
        </div>
      )}

      <div className="ds-linefilters">
        {PERSONE.map(([k, l]) => <button key={k} type="button" className={`ds-fp ${who === k ? 'on' : ''}`} onClick={() => setWho(k)}>{l}</button>)}
      </div>
      <div className="ds-linefilters" style={{ marginTop: -4 }}>
        <button type="button" className={`ds-fp ${tipo === '' ? 'on' : ''}`} onClick={() => setTipo('')}>Tutto</button>
        {TIPI.map((t) => <button key={t} type="button" className={`ds-fp ${tipo === t ? 'on' : ''}`} onClick={() => setTipo(tipo === t ? '' : t)}>{t}</button>)}
      </div>
      {!shown.length ? <p className="muted center">Nessuna attività per questo filtro.</p> : shown.map((r) => {
        const av = avatar(r.chi);
        const sum = summarize(r);
        return (
          <div className="ds-act" key={r.id}>
            <span className="ds-actav" style={{ background: av.bg }}>{av.i}</span>
            <div className="ds-actmain">
              <div className="ds-actverb">{verbOf(r)} <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>· {av.name}</span></div>
              {sum && <div className="ds-actsum">{sum}</div>}
            </div>
            <div className="ds-actright">
              <span className="ds-acttag">{tagOf(r)}</span>
              <span className="ds-actago">{ago(r.ts)}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
