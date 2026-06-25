import { useState } from 'react';
import ProductPicker from './ProductPicker';
import SupplierPicker from './SupplierPicker';
import { writeApi, oggi } from '../lib/api';
import type { Product } from '../lib/api';

export default function OrderForm({ pin, chi, onDone }: { pin: string; chi: string; onDone: () => void }) {
  const [prod, setProd] = useState<Product | null>(null);
  const [qta, setQta] = useState('');
  const [forn, setForn] = useState('');
  const [data, setData] = useState(oggi());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null);

  async function submit() {
    if (!prod) return setMsg({ t: 'err', x: 'Scegli un prodotto' });
    if (!(Number(qta) > 0)) return setMsg({ t: 'err', x: 'Quantità non valida' });
    setBusy(true); setMsg(null);
    try {
      await writeApi('order', {
        codice: prod.codice, item: prod.item, variant: prod.variant,
        fornitore: forn || null, qty_ordered: Number(qta), data_ordine: data,
      }, pin, chi);
      onDone();
    } catch (e) {
      setMsg({ t: 'err', x: (e as Error).message }); setBusy(false);
    }
  }

  return (
    <div className="form">
      <label className="fl">Cosa hai ordinato</label>
      <ProductPicker selected={prod} onPick={(p) => { setProd(p); setMsg(null); }} />
      {prod && (
        <>
          <div className="grid2">
            <div><label className="fl">Quanti pezzi</label>
              <input className="num" type="number" inputMode="numeric" value={qta} onChange={(e) => setQta(e.target.value)} placeholder="0" /></div>
            <div><label className="fl">Quando ordinato</label>
              <input className="txt" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
          </div>
          <label className="fl">Da chi</label>
          <SupplierPicker value={forn} onChange={setForn} />
          <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : 'Salva ordine'}</button>
        </>
      )}
      {msg && <div className={`msg ${msg.t}`}>{msg.x}</div>}
    </div>
  );
}
