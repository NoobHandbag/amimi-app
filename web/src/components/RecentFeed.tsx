import { useEffect, useState } from 'react';
import Icon from './Icon';
import { fetchRecent } from '../lib/api';
import type { Activity } from '../lib/api';

// [icona, etichetta]. Le emoji sono uscite dall'interfaccia (DESIGN.md §1.6): il primo
// campo e' ora il nome di un'icona a linea di <Icon>.
const META: Record<string, [string, string]> = {
  purchases: ['box', 'Arrivo'], counts: ['count', 'Conta'], gifts_offline: ['gift', 'Regalo'],
  b2b_movements: ['store', 'B2B'], products: ['tag', 'Prodotto'],
  supplier_orders: ['box', 'Ordine fornitore'], expenses: ['euro', 'Spesa'], returns: ['return', 'Reso'],
  qromo_sales: ['bag', 'Vendita Qromo'], shopify_orders: ['globe', 'Ordine online'], shopify_line_items: ['globe', 'Ordine online'],
  ce_snapshots: ['camera', 'Chiusura mese'], shopify_stock: ['refresh', 'Stock Shopify'], stock_adjustments: ['calculator', 'Rettifica stock'],
};
// op più specifici della tabella
const OPMETA: Record<string, [string, string]> = {
  close_month: ['camera', 'Chiusura mese'], stock_autopush: ['refresh', 'Stock → Shopify (auto)'],
  shopify_realign: ['refresh', 'Stock → Shopify'], expense_approve: ['check-circle', 'Spesa verificata'],
  expense_propose: ['euro', 'Spesa proposta'], expense_manual: ['euro', 'Spesa'],
  count_apply: ['count', 'Conta'], product_verify: ['check-circle', 'Prodotto verificato'],
  order_multi: ['box', 'Ordine fornitore'], arrival: ['box', 'Arrivo merce'], arrival_set: ['box', 'Arrivo corretto'],
  test_cleanup: ['broom', 'Pulizia dati test'], orphan_cleanup: ['broom', 'Pulizia anagrafica'],
  sale_correct: ['swap', 'Vendita ri-mappata'], guard_fix: ['shield', 'Fix della guardia'],
  qromo_sale: ['bag', 'Vendita Qromo'], gift: ['gift', 'Regalo'], return: ['return', 'Reso'],
};
const CHI: Record<string, string> = { 'qromo-forward': 'Qromo (auto)', 'shopify-sync': 'Shopify (auto)', cron: 'automatico', claude: 'assistente', Bene: 'Benny', Ginevra: 'Ginni' };
const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);

function ago(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'ora';
  if (s < 3600) return `${Math.floor(s / 60)}m fa`;
  if (s < 86400) return `${Math.floor(s / 3600)}h fa`;
  return `${Math.floor(s / 86400)}g fa`;
}

/** riga di sintesi specifica per tipo (cosa è successo, in una frase) */
function summarize(r: Activity): string {
  const a = (r.after ?? {}) as Record<string, unknown>;
  const n = (k: string) => (a[k] != null ? Number(a[k]) : null);
  const s = (k: string) => (a[k] != null ? String(a[k]) : null);
  switch (r.op) {
    case 'close_month': return `CE ${r.rowId ?? ''} congelato (${['amimi', 'totale'].filter((k) => a[k]).map((k) => `${k}: ${a[k]}`).join(', ')})`;
    case 'stock_autopush': return `${n('pushed') ?? 0} aggiornati, ${n('held') ?? 0} in attesa di conta`;
    case 'shopify_realign': return 'riallineo manuale su Shopify';
    case 'expense_approve': return [s('categoria'), s('note')?.slice(0, 60)].filter(Boolean).join(' · ');
    case 'expense_manual': case 'expense_propose': return [s('operazione')?.slice(0, 40), n('costo') != null ? eur(Math.abs(n('costo')!)) : null, s('categoria')].filter(Boolean).join(' · ');
    case 'count_apply': return `${s('codice') ?? ''}: contati ${n('contati') ?? '?'} (era ${n('giac_prima') ?? '?'}, Δ${n('delta') ?? '?'})`;
    case 'product_verify': return r.rowId ? `#${r.rowId.slice(0, 8)}` : '';
    case 'order_multi': return `${s('fornitore') ?? ''} · ${n('righe') ?? '?'} righe${n('stubs') ? ` · ${n('stubs')} prodotti nuovi` : ''}`;
    case 'arrival': case 'arrival_set': return `${s('codice') ?? ''} · ${n('qty') ?? n('target') ?? '?'} pz`;
    case 'qromo_sale': return `${s('codice') ?? ''} × ${n('qty') ?? 1}`;
    case 'sale_correct': return `${s('from') ?? ''} → ${s('to') ?? ''}`;
    case 'test_cleanup': return 'rimozione dati di test (dettagli qui dentro)';
    default: {
      const codice = s('codice');
      const qty = n('quantita');
      const costo = n('costo');
      return [codice, qty != null ? `× ${qty}` : null, costo != null ? eur(Math.abs(costo)) : null].filter(Boolean).join(' ');
    }
  }
}

/** dettaglio espanso: chiavi utili del payload, formattate */
const HIDE = new Set(['results', 'actions', 'chi', 'source']);
function DetailRows({ r }: { r: Activity }) {
  const a = (r.after ?? {}) as Record<string, unknown>;
  const rows = Object.entries(a)
    .filter(([k, v]) => v != null && !HIDE.has(k) && typeof v !== 'object')
    .slice(0, 12);
  return (
    <div className="feeddetail">
      <div className="fdrow"><span>Quando</span><b>{new Date(r.ts).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })}</b></div>
      <div className="fdrow"><span>Chi</span><b>{r.chi ? (CHI[r.chi] ?? r.chi) : '—'}</b></div>
      <div className="fdrow"><span>Cosa</span><b>{(r.op ?? 'inserimento').replace(/_/g, ' ')} · {r.tbl.replace(/_/g, ' ')}</b></div>
      {rows.map(([k, v]) => (
        <div className="fdrow" key={k}><span>{k.replace(/_/g, ' ')}</span><b>{String(v).slice(0, 90)}</b></div>
      ))}
    </div>
  );
}

export default function RecentFeed() {
  const [rows, setRows] = useState<Activity[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { fetchRecent().then(setRows).catch(() => {}); }, []);
  if (!rows.length) return null;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Ultimi inserimenti</h2>
      <div className="list">
        {rows.map((r) => {
          const m = (r.op && OPMETA[r.op]) || META[r.tbl] || ['circle', r.tbl.replace(/_/g, ' ')];
          const sum = summarize(r);
          const isOpen = open === r.id;
          return (
            <div key={r.id}>
              <button type="button" className="row clickrow" style={{ width: '100%', textAlign: 'left' }} onClick={() => setOpen(isOpen ? null : r.id)}>
                <div className="grow">
                  <div className="rt" style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span className="ds-itile" style={{ width: 26, height: 26 }}><Icon name={m[0]} size={15} /></span>{m[1]}</div>
                  <div className="rs">{sum || r.codice || ''}{r.chi ? ` · ${CHI[r.chi] ?? r.chi}` : ''}</div>
                </div>
                <div className="rs" style={{ whiteSpace: 'nowrap' }}>{ago(r.ts)} <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} /></div>
              </button>
              {isOpen && <DetailRows r={r} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
