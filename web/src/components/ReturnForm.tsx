import { useState } from 'react';
import ProductPicker from './ProductPicker';
import { addReturn, oggi } from '../lib/api';
import type { Product } from '../lib/api';

const CANALI: [string, string][] = [['qromo', 'Negozio'], ['online', 'Online'], ['b2b', 'B2B / negozio terzo']];
const MOTIVI = ['Difetto', 'Taglia/Misura', 'Ripensamento', 'Cambio', 'Altro'];

export default function ReturnForm({ pin, chi }: { pin: string; chi: string }) {
  const [prod, setProd] = useState<Product | null>(null);
  const [qty, setQty] = useState('1');
  const [canale, setCanale] = useState('qromo');
  const [importo, setImporto] = useState('');
  const [rientra, setRientra] = useState(true);
  const [motivo, setMotivo] = useState('Difetto');
  const [sostituto, setSostituto] = useState<Product | null>(null);
  const [data, setData] = useState(oggi());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null);

  const isCambio = motivo === 'Cambio';

  async function submit() {
    if (!prod) return setMsg({ t: 'err', x: 'Scegli il prodotto reso' });
    if (!(Number(qty) > 0)) return setMsg({ t: 'err', x: 'Quantità non valida' });
    setBusy(true); setMsg(null);
    try {
      await addReturn({
        codice: prod.codice, item: prod.item, variant: prod.variant, quantita: Number(qty),
        canale, importo_rimborsato: importo === '' ? 0 : Number(importo), rientra_stock: rientra,
        motivo, sostituito_con: isCambio && sostituto ? sostituto.codice : null, data, note,
      }, pin, chi);
      setMsg({ t: 'ok', x: `Reso registrato${rientra ? ' · rientra in magazzino' : ' · non rientra (scartato)'}` });
      setProd(null); setSostituto(null); setQty('1'); setImporto(''); setNote(''); setMotivo('Difetto');
    } catch (e) { setMsg({ t: 'err', x: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <div className="form">
      <label className="fl">Prodotto reso</label>
      <ProductPicker selected={prod} onPick={setProd} />

      <div className="grid2">
        <div><label className="fl">Quantità</label>
          <input className="num" type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div><label className="fl">Data</label>
          <input className="num" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
      </div>

      <label className="fl">Canale di vendita originale</label>
      <div className="supgrid">
        {CANALI.map(([k, l]) => <button key={k} type="button" className={`supcard ${canale === k ? 'on' : ''}`} onClick={() => setCanale(k)}>{l}</button>)}
      </div>

      <label className="fl">Motivo</label>
      <div className="supgrid">
        {MOTIVI.map((m) => <button key={m} type="button" className={`supcard ${motivo === m ? 'on' : ''}`} onClick={() => setMotivo(m)}>{m}</button>)}
      </div>

      {isCambio && (
        <>
          <label className="fl">Sostituito con (prodotto dato in cambio)</label>
          <ProductPicker selected={sostituto} onPick={setSostituto} />
          <p className="note">Il pezzo reso rientra in magazzino. Registra l’uscita del prodotto sostitutivo come vendita normale (Qromo/Shopify).</p>
        </>
      )}

      <div className="grid2">
        <div><label className="fl">Importo rimborsato €</label>
          <input className="num" type="number" inputMode="decimal" value={importo} onChange={(e) => setImporto(e.target.value)} placeholder={isCambio ? '0 (cambio)' : '0,00'} /></div>
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
