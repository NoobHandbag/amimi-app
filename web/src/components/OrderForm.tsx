import { useState } from 'react';
import ProductPicker from './ProductPicker';
import SupplierPicker from './SupplierPicker';
import NumberStepper from './NumberStepper';
import { writeApi, oggi } from '../lib/api';
import type { Product } from '../lib/api';
import { toast } from '../lib/toast';

export default function OrderForm({ pin, chi, onDone }: { pin: string; chi: string; onDone: () => void }) {
  const [prod, setProd] = useState<Product | null>(null);
  const [qta, setQta] = useState('1');
  const [forn, setForn] = useState('');
  const [data, setData] = useState(oggi());
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!prod) return toast('Scegli un prodotto', 'err');
    if (!(Number(qta) > 0)) return toast('Quantità non valida', 'err');
    setBusy(true);
    try {
      await writeApi('order', {
        codice: prod.codice, item: prod.item, variant: prod.variant,
        fornitore: forn || null, qty_ordered: Number(qta), data_ordine: data,
      }, pin, chi);
      toast(`Ordine salvato · ${prod.item} ×${qta}`, 'ok');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'err'); setBusy(false);
    }
  }

  return (
    <div className="form">
      <label className="fl">Cosa hai ordinato</label>
      <ProductPicker selected={prod} onPick={(p) => setProd(p)} />
      {prod && (
        <>
          <div className="grid2">
            <div><label className="fl">Quanti pezzi</label><NumberStepper value={qta} onChange={setQta} min={1} /></div>
            <div><label className="fl">Quando ordinato</label>
              <input className="txt" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
          </div>
          <label className="fl">Da chi</label>
          <SupplierPicker value={forn} onChange={setForn} />
          <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : 'Salva ordine'}</button>
        </>
      )}
    </div>
  );
}
