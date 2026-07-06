import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import ExportBtn from '../components/ExportBtn';
import Icon from '../components/Icon';

// Raw-data browser (AppSheet-style): curated business tables, read-only, searchable + CSV.
// NEVER include app_flags/app_config (secrets) or change_log/health_log (noise).
type Col = { field: string; label: string };
type TableCfg = { key: string; label: string; icon: string; desc: string; source: string; order: { field: string; asc?: boolean }; cols: Col[] };

export const TABLES: TableCfg[] = [
  { key: 'ordini', label: 'Ordini fornitore', icon: 'box', desc: 'Tutti gli ordini ai fornitori', source: 'supplier_orders', order: { field: 'created_at' }, cols: [
    { field: 'data_ordine', label: 'Data' }, { field: 'fornitore', label: 'Fornitore' }, { field: 'item', label: 'Modello' }, { field: 'variant', label: 'Variante' }, { field: 'codice', label: 'Codice' }, { field: 'qty_ordered', label: 'Ordinati' }, { field: 'qty_arrived', label: 'Arrivati' }, { field: 'costo_unitario', label: 'Costo/pz' }, { field: 'nuovo_riordino', label: 'Tipo' }, { field: 'data_consegna', label: 'Consegna' }] },
  { key: 'acquisti', label: 'Arrivi / Acquisti', icon: 'inbox', desc: 'Pezzi arrivati / acquistati', source: 'purchases', order: { field: 'created_at' }, cols: [
    { field: 'data', label: 'Data' }, { field: 'fornitore', label: 'Fornitore' }, { field: 'item', label: 'Modello' }, { field: 'variant', label: 'Variante' }, { field: 'codice', label: 'Codice' }, { field: 'quantita', label: 'Qtà' }, { field: 'costo_unitario', label: 'Costo/pz' }, { field: 'costo_totale', label: 'Totale' }, { field: 'tipologia', label: 'Tipo' }] },
  { key: 'prodotti', label: 'Prodotti', icon: 'tag', desc: 'Anagrafica articoli', source: 'products', order: { field: 'item', asc: true }, cols: [
    { field: 'codice', label: 'Codice' }, { field: 'item', label: 'Modello' }, { field: 'variant', label: 'Variante' }, { field: 'categoria', label: 'Cat.' }, { field: 'retail_price', label: 'Prezzo' }, { field: 'cogs', label: 'COGS' }, { field: 'status', label: 'Stato' }, { field: 'verificato', label: 'Verif.' }] },
  { key: 'vendite_negozio', label: 'Vendite QROMO (negozio)', icon: 'store', desc: 'Vendite dal POS del negozio', source: 'qromo_sales', order: { field: 'data' }, cols: [
    { field: 'data', label: 'Data' }, { field: 'nome', label: 'Nome' }, { field: 'cognome', label: 'Cognome' }, { field: 'item', label: 'Modello' }, { field: 'variant', label: 'Variante' }, { field: 'codice', label: 'Codice' }, { field: 'quantita', label: 'Qtà' }, { field: 'prezzo', label: 'Prezzo' }, { field: 'payment_method', label: 'Pagamento' }] },
  { key: 'vendite_online', label: 'Vendite Shopify (online)', icon: 'globe', desc: 'Ordini dal sito', source: 'shopify_orders', order: { field: 'created_at_shop' }, cols: [
    { field: 'created_at_shop', label: 'Data' }, { field: 'order_number', label: 'Ordine' }, { field: 'customer_name', label: 'Cliente' }, { field: 'net_total', label: 'Netto' }, { field: 'gross_total', label: 'Lordo' }, { field: 'financial_status', label: 'Pagamento' }, { field: 'fulfillment_status', label: 'Evasione' }] },
  { key: 'b2b', label: 'Conto vendita B2B', icon: 'handshake', desc: 'Movimenti nei negozi', source: 'b2b_movements', order: { field: 'data' }, cols: [
    { field: 'data', label: 'Data' }, { field: 'negozio', label: 'Negozio' }, { field: 'modello', label: 'Modello' }, { field: 'codice', label: 'Codice' }, { field: 'quantita', label: 'Qtà' }, { field: 'tipo_movimento', label: 'Tipo' }, { field: 'prezzo_retail', label: 'Prezzo' }, { field: 'perc_negozio', label: '% negozio' }, { field: 'incasso_amimi', label: 'Incasso Amimì' }, { field: 'stato', label: 'Stato' }] },
  { key: 'resi', label: 'Resi', icon: 'return', desc: 'Resi e cambi', source: 'returns', order: { field: 'data' }, cols: [
    { field: 'data', label: 'Data' }, { field: 'item', label: 'Modello' }, { field: 'variant', label: 'Variante' }, { field: 'codice', label: 'Codice' }, { field: 'quantita', label: 'Qtà' }, { field: 'canale', label: 'Canale' }, { field: 'importo_rimborsato', label: 'Rimborso' }, { field: 'rientra_stock', label: 'Rientra' }, { field: 'motivo', label: 'Motivo' }] },
  { key: 'regali', label: 'Regali', icon: 'gift', desc: 'Regali / vendite manuali', source: 'gifts_offline', order: { field: 'data' }, cols: [
    { field: 'data', label: 'Data' }, { field: 'nome', label: 'Nome' }, { field: 'cognome', label: 'Cognome' }, { field: 'item', label: 'Modello' }, { field: 'variant', label: 'Variante' }, { field: 'codice', label: 'Codice' }, { field: 'quantita', label: 'Qtà' }, { field: 'prezzo', label: 'Prezzo' }, { field: 'kind', label: 'Tipo' }] },
  { key: 'spese', label: 'Spese', icon: 'euro', desc: 'Spese registrate', source: 'expenses', order: { field: 'created_at' }, cols: [
    { field: 'date_paid', label: 'Data' }, { field: 'operazione', label: 'Operazione' }, { field: 'costo', label: 'Costo' }, { field: 'categoria', label: 'Categoria' }, { field: 'sottocategoria', label: 'Sottocat.' }, { field: 'amimi', label: 'Amimì' }, { field: 'status', label: 'Stato' }] },
  { key: 'conte', label: 'Conte', icon: 'count', desc: 'Conte fisiche', source: 'counts', order: { field: 'created_at' }, cols: [
    { field: 'data_conta', label: 'Data' }, { field: 'modello', label: 'Modello' }, { field: 'variante', label: 'Variante' }, { field: 'codice', label: 'Codice' }, { field: 'contati', label: 'Contati' }, { field: 'giac_snapshot', label: 'Giac.' }, { field: 'delta', label: 'Delta' }, { field: 'stato', label: 'Stato' }] },
];

const fmt = (v: unknown) => {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'sì' : 'no';
  const s = String(v);
  return s.length > 44 ? s.slice(0, 44) + '…' : s;
};

function TableView({ cfg, onBack }: { cfg: TableCfg; onBack: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setRows(null); setErr(null);
    supabase.from(cfg.source).select(cfg.cols.map((c) => c.field).join(','))
      .order(cfg.order.field, { ascending: !!cfg.order.asc }).limit(limit)
      .then(({ data, error }) => { if (error) setErr(error.message); setRows((data ?? []) as unknown as Record<string, unknown>[]); });
  }, [cfg, limit]);
  const s = q.trim().toLowerCase();
  const shown = !rows ? [] : (s ? rows.filter((r) => cfg.cols.some((c) => String(r[c.field] ?? '').toLowerCase().includes(s))) : rows);
  return (
    <div>
      <button className="back" onClick={onBack}>← Tutte le tabelle</button>
      <div className="lblrow"><h2 className="sech" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Icon name={cfg.icon} size={20} /> {cfg.label}</h2>
        <ExportBtn name={cfg.key} rows={() => shown} /></div>
      <input className="search" placeholder="Cerca in tabella…" value={q} onChange={(e) => setQ(e.target.value)} />
      {err ? <div className="card err">Niente accesso a questa tabella ({err}).</div>
        : rows == null ? <p className="muted center">Carico…</p>
        : !shown.length ? <div className="card muted center">Nessuna riga.</div> : (
          <div className="card"><div className="tablewrap"><table className="sortable invtable rawtable">
            <thead><tr>{cfg.cols.map((c) => <th key={c.field}>{c.label}</th>)}</tr></thead>
            <tbody>{shown.map((r, i) => (
              <tr key={i}>{cfg.cols.map((c) => <td key={c.field} className={typeof r[c.field] === 'number' ? '' : 'l'}>{fmt(r[c.field])}</td>)}</tr>
            ))}</tbody>
          </table></div></div>
        )}
      {rows && rows.length >= limit && <button className="addnew" onClick={() => setLimit((l) => l + 100)}>Carica altre 100</button>}
      {rows != null && <p className="note">{shown.length} righe{q ? ' (filtrate)' : ''}{rows.length >= limit ? ` · prime ${limit}` : ''}.</p>}
    </div>
  );
}

export function DataTables({ initial }: { initial?: string }) {
  const [openKey, setOpenKey] = useState<string | undefined>(initial);
  const cfg = TABLES.find((t) => t.key === openKey);
  if (cfg) return <TableView cfg={cfg} onBack={() => setOpenKey(undefined)} />;
  return (
    <>
      <p className="note">Sfoglia i dati grezzi. Sola lettura.</p>
      <div className="tipi">
        {TABLES.map((t) => (
          <button key={t.key} className="tipo" type="button" onClick={() => setOpenKey(t.key)}>
            <span className="ti"><Icon name={t.icon} size={26} /></span>
            <span className="tt">{t.label}</span>
            <span className="td">{t.desc}</span>
          </button>
        ))}
      </div>
    </>
  );
}
