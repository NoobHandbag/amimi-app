import { useEffect, useState } from 'react';
import ProductPicker from './ProductPicker';
import { addReturn, fetchSalesByCodice, oggi } from '../lib/api';
import type { Product, SaleRow } from '../lib/api';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const MOTIVI = ['Difetto', 'Taglia/Misura', 'Ripensamento', 'Cambio', 'Altro'];

/** Sale-anchored returns: pick product -> its recent sales -> pick the sale -> reso/cambio. */
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
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null);

  useEffect(() => { if (prod) { setSales(null); fetchSalesByCodice(prod.codice).then(setSales).catch(() => setSales([])); } }, [prod]);

  const isCambio = motivo === 'Cambio';
  const canale = sale ? (sale.source === 'qromo' ? 'qromo' : 'online') : 'qromo';

  function reset() {
    setProd(null); setSale(null); setSales(null); setSostituto(null);
    setQty('1'); setImporto(''); setNote(''); setMotivo('Difetto'); setRientra(true);
  }
  async function submit() {
    if (!prod) return setMsg({ t: 'err', x: 'Scegli il prodotto' });
    if (!(Number(qty) > 0)) return setMsg({ t: 'err', x: 'Quantità non valida' });
    setBusy(true); setMsg(null);
    try {
      await addReturn({
        codice: prod.codice, item: prod.item, variant: prod.variant, quantita: Number(qty),
        canale, importo_rimborsato: importo === '' ? 0 : Number(importo), rientra_stock: rientra,
        motivo, sostituito_con: isCambio && sostituto ? sostituto.codice : null, data,
        note: [note, sale && sale.id ? `vendita ${sale.source} ${sale.data}` : ''].filter(Boolean).join(' · '),
      }, pin, chi);
      setMsg({ t: 'ok', x: `Reso registrato${rientra ? ' · rientra in magazzino' : ' · non rientra'}` });
      reset();
    } catch (e) { setMsg({ t: 'err', x: (e as Error).message }); } finally { setBusy(false); }
  }

  // STEP 1 — product
  if (!prod) return (
    <div className="form">
      <label className="fl">Prodotto reso</label>
      <ProductPicker selected={null} onPick={setProd} />
      <p className="note">Scegli il prodotto: ti mostro le sue vendite recenti, poi scegli quale è stata resa.</p>
      {msg && <div className={`msg ${msg.t}`}>{msg.x}</div>}
    </div>
  );

  // STEP 2 — the sale
  if (!sale) return (
    <div>
      <button className="back" onClick={() => setProd(null)}>← {prod.item ?? prod.codice}</button>
      <p className="note">Quale vendita di <b>{prod.item ?? prod.codice}</b> è stata resa?</p>
      {sales == null ? <p className="muted center">Carico vendite…</p>
        : !sales.length ? (
          <div className="card muted center">Nessuna vendita recente trovata.
            <div style={{ marginTop: 10 }}><button className="chip" onClick={() => setSale({ source: 'qromo', id: '', data: oggi(), qty: 1, price: null, descr: 'Reso senza vendita collegata', ref: '' })}>Reso senza vendita →</button></div>
          </div>
        ) : (
          <div className="list">{sales.map((s) => (
            <button key={s.source + s.id} className="salerow" onClick={() => { setSale(s); setQty(String(s.qty || 1)); setImporto(s.price != null ? String(s.price) : ''); }}>
              <div><div className="rt">{s.descr}</div><div className="rs">{s.source === 'qromo' ? 'Negozio' : 'Online'} · {s.data ?? ''} · {s.qty}× {s.price != null ? eur(s.price) : ''}</div></div>
              <span className="chev">›</span>
            </button>
          ))}</div>
        )}
    </div>
  );

  // STEP 3 — details
  return (
    <div className="form">
      <button className="back" onClick={() => setSale(null)}>← vendite di {prod.item ?? prod.codice}</button>
      <div className="picked"><div className="pickedtxt">
        <div className="rt">{prod.item ?? prod.codice} <span className="rs">{prod.variant ?? ''}</span></div>
        <div className="rs">{sale.descr} · {sale.source === 'qromo' ? 'Negozio' : 'Online'} · {sale.data ?? ''} · {sale.qty}× {sale.price != null ? eur(sale.price) : ''}</div>
      </div></div>

      <div className="grid2">
        <div><label className="fl">Quantità resa</label><input className="num" type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div><label className="fl">Data reso</label><input className="num" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
      </div>

      <label className="fl">Motivo</label>
      <div className="supgrid">{MOTIVI.map((m) => <button key={m} type="button" className={`supcard ${motivo === m ? 'on' : ''}`} onClick={() => setMotivo(m)}>{m}</button>)}</div>

      {isCambio && (
        <>
          <label className="fl">Sostituito con (prodotto dato in cambio)</label>
          <ProductPicker selected={sostituto} onPick={setSostituto} />
          <p className="note">Il pezzo reso rientra in magazzino. L’uscita del sostitutivo va registrata come vendita normale.</p>
        </>
      )}

      <div className="grid2">
        <div><label className="fl">Importo rimborsato €</label><input className="num" type="number" inputMode="decimal" value={importo} onChange={(e) => setImporto(e.target.value)} placeholder={isCambio ? '0 (cambio)' : '0,00'} /></div>
        <div><label className="fl">Rientra in magazzino?</label>
          <div className="seg"><button className={rientra ? 'on' : ''} onClick={() => setRientra(true)}>Sì</button><button className={!rientra ? 'on' : ''} onClick={() => setRientra(false)}>No</button></div></div>
      </div>

      <label className="fl">Note (opzionale)</label>
      <input className="txt" value={note} onChange={(e) => setNote(e.target.value)} placeholder="—" />

      <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : 'Registra reso'}</button>
      {msg && <div className={`msg ${msg.t}`}>{msg.x}</div>}
    </div>
  );
}
