import { useEffect, useState } from 'react';
import ProductPicker from './ProductPicker';
import NumberStepper from './NumberStepper';
import { addReturn, fetchSalesByCodice, oggi } from '../lib/api';
import type { Product, SaleRow } from '../lib/api';
import { toast } from '../lib/toast';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const MOTIVI = ['Difetto', 'Taglia/Misura', 'Ripensamento', 'Cambio', 'Altro'];
const nm = (p: Product) => [p.item, p.variant].filter(Boolean).join(' ') || p.codice;
const Thumb = ({ p }: { p: Product }) => (p.image_url ? <img className="invimg sm" src={p.image_url} alt="" /> : <div className="invimg sm ph">{(p.item ?? p.codice).slice(0, 2)}</div>);

/** Sale-anchored returns: pick product -> its recent sales (with photo + customer) -> pick the sale -> reso/cambio. */
export default function ReturnForm({ pin, chi }: { pin: string; chi: string }) {
  const [prod, setProd] = useState<Product | null>(null);
  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [sale, setSale] = useState<SaleRow | null>(null);
  const [qty, setQty] = useState('1');
  const [motivo, setMotivo] = useState('Difetto');
  const [rientra, setRientra] = useState(true);
  const [importo, setImporto] = useState('');
  const [sostituto, setSostituto] = useState<Product | null>(null);
  const [data, setData] = useState(oggi());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (prod) { setSales(null); fetchSalesByCodice(prod.codice).then(setSales).catch(() => setSales([])); } }, [prod]);

  const isCambio = motivo === 'Cambio';
  const canale = sale ? (sale.source === 'qromo' ? 'qromo' : 'online') : 'qromo';

  // Cambio: rimborso 0 di default (decisione call 06-07 item 5); tornando a un reso normale
  // si ripropone il prezzo della vendita scelta.
  function pickMotivo(m: string) {
    setMotivo(m);
    if (m === 'Cambio') setImporto('0');
    else if (importo === '0' || importo === '') setImporto(sale?.price != null ? String(sale.price) : '');
  }

  function reset() {
    setProd(null); setSale(null); setSales(null); setSostituto(null);
    setQty('1'); setImporto(''); setNote(''); setMotivo('Difetto'); setRientra(true);
  }
  async function submit() {
    if (!prod) return toast('Scegli il prodotto', 'err');
    if (!(Number(qty) > 0)) return toast('Quantità non valida', 'err');
    setBusy(true);
    try {
      await addReturn({
        codice: prod.codice, item: prod.item, variant: prod.variant, quantita: Number(qty),
        canale, importo_rimborsato: importo === '' ? 0 : Number(importo), rientra_stock: rientra,
        motivo, sostituito_con: isCambio && sostituto ? sostituto.codice : null, data,
        note: [note, sale && sale.id ? `vendita ${sale.source} ${sale.data}${sale.descr ? ' · ' + sale.descr : ''}` : ''].filter(Boolean).join(' · '),
      }, pin, chi);
      toast(`Reso registrato${rientra ? ' · rientra in magazzino' : ' · non rientra'}`, 'ok');
      reset();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  // STEP 1 — product
  if (!prod) return (
    <div className="form">
      <label className="fl">Prodotto reso</label>
      <ProductPicker selected={null} onPick={setProd} />
      <p className="note">Scegli il prodotto: ti mostro le sue vendite recenti (con foto e cliente), poi scegli quale è stata resa.</p>
    </div>
  );

  // STEP 2 — the sale
  if (!sale) return (
    <div>
      <button className="back" onClick={() => setProd(null)}>← {nm(prod)}</button>
      <p className="note">Quale vendita di <b>{nm(prod)}</b> è stata resa?</p>
      {sales == null ? <p className="muted center">Carico vendite…</p>
        : !sales.length ? (
          <div className="card muted center">Nessuna vendita recente trovata.
            <div style={{ marginTop: 10 }}><button className="chip" onClick={() => setSale({ source: 'qromo', id: '', data: oggi(), qty: 1, price: null, descr: 'Reso senza vendita collegata', ref: '' })}>Reso senza vendita →</button></div>
          </div>
        ) : (
          <div className="list">{sales.map((s) => (
            <button key={s.source + s.id} className="salerow" onClick={() => { setSale(s); setQty(String(s.qty || 1)); setImporto(s.price != null ? String(s.price) : ''); }}>
              <Thumb p={prod} />
              <div className="grow"><div className="rt">{s.descr}</div><div className="rs">{s.source === 'qromo' ? '🏬 QROMO' : '🌐 Shopify'} · {s.data ?? ''} · {s.qty}× {s.price != null ? eur(s.price) : ''}</div></div>
              <span className="chev">›</span>
            </button>
          ))}</div>
        )}
    </div>
  );

  // STEP 3 — details
  return (
    <div className="form">
      <button className="back" onClick={() => setSale(null)}>← vendite di {nm(prod)}</button>
      <div className="picked">
        <Thumb p={prod} />
        <div className="pickedtxt">
          <div className="rt">{nm(prod)}</div>
          <div className="rs">{sale.descr} · {sale.source === 'qromo' ? 'QROMO' : 'Shopify'} · {sale.data ?? ''} · {sale.qty}× {sale.price != null ? eur(sale.price) : ''}
            {sale.adminUrl ? <> · <a href={sale.adminUrl} target="_blank" rel="noreferrer">apri l'ordine su Shopify ↗</a></> : null}</div>
        </div>
      </div>
      {sale.source === 'shopify' && <p className="note">Il rimborso dei soldi si fa su Shopify (link qui sopra); qui registri il rientro fisico in magazzino. Non toccare lo stock su Shopify a mano: si riallinea da solo ogni ora.</p>}

      <div className="grid2">
        <div><label className="fl">Quantità resa</label><NumberStepper value={qty} onChange={setQty} min={1} /></div>
        <div><label className="fl">Data reso</label><input className="num" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
      </div>

      <label className="fl">Motivo</label>
      <div className="supgrid">{MOTIVI.map((m) => <button key={m} type="button" className={`supcard ${motivo === m ? 'on' : ''}`} onClick={() => pickMotivo(m)}>{m}</button>)}</div>

      {isCambio && (
        <>
          <label className="fl">Sostituito con (prodotto dato in cambio)</label>
          <ProductPicker selected={sostituto} onPick={setSostituto} />
          <p className="note">Il pezzo reso rientra in magazzino. L'uscita del sostitutivo va registrata come vendita normale.</p>
        </>
      )}

      <div className="grid2">
        <div><label className="fl">Importo rimborsato €</label><NumberStepper value={importo} onChange={setImporto} decimal step={5} min={-9999} placeholder="0,00" /></div>
        <div><label className="fl">Rientra in magazzino?</label>
          <div className="seg"><button className={rientra ? 'on' : ''} onClick={() => setRientra(true)}>Sì</button><button className={!rientra ? 'on' : ''} onClick={() => setRientra(false)}>No</button></div></div>
      </div>
      {isCambio && <p className="note">Se il cliente paga la differenza (borsa più cara), metti l'importo <b>negativo</b>: −10 = il cliente ci ha dato 10 €.</p>}

      <label className="fl">Note (opzionale)</label>
      <input className="txt" value={note} onChange={(e) => setNote(e.target.value)} placeholder="—" />

      <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : 'Registra reso'}</button>
    </div>
  );
}
