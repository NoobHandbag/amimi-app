import { useState } from 'react';
import ProductPicker from './ProductPicker';
import SupplierPicker from './SupplierPicker';
import NumberStepper from './NumberStepper';
import { writeApi, oggi, fetchLastPurchase } from '../lib/api';
import type { Product } from '../lib/api';
import { toast } from '../lib/toast';

export default function PurchaseForm({ pin, chi }: { pin: string; chi: string }) {
  const [prod, setProd] = useState<Product | null>(null);
  const [qta, setQta] = useState('1');
  const [costo, setCosto] = useState('');
  const [data, setData] = useState(oggi());
  const [forn, setForn] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  function onPick(p: Product | null) {
    setProd(p); setHint(null);
    if (p) {
      fetchLastPurchase(p.codice).then((l) => {
        if (!l) return;
        if (l.costo_unitario != null) setCosto(String(l.costo_unitario));
        if (l.fornitore) setForn(l.fornitore);
        setHint(`Ultimo acquisto: €${l.costo_unitario ?? '—'}${l.fornitore ? ' · ' + l.fornitore : ''}`);
      }).catch(() => {});
    }
  }

  async function submit() {
    if (!prod) return toast('Scegli un prodotto', 'err');
    if (!(Number(qta) > 0)) return toast('Quantità non valida', 'err');
    setBusy(true);
    try {
      await writeApi('purchase', {
        codice: prod.codice, item: prod.item, variant: prod.variant, categoria: prod.categoria ?? 'BAG',
        tipologia: 'Prodotto Finito', unita_misura: 'Pezzi',
        quantita: Number(qta), costo_unitario: costo === '' ? null : Number(costo),
        data, fornitore: forn || null,
      }, pin, chi);
      toast(`Arrivo registrato · ${prod.item} ${prod.variant ?? ''} ×${qta}`, 'ok');
      setProd(null); setQta('1'); setCosto(''); setForn('');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form">
      <label className="fl">Prodotto</label>
      <ProductPicker selected={prod} onPick={onPick} />
      {hint && <div className="hintline">{hint}</div>}
      {prod && (
        <>
          <div className="grid2">
            <div><label className="fl">Quantità</label><NumberStepper value={qta} onChange={setQta} min={1} /></div>
            <div><label className="fl">Costo unit. €</label><NumberStepper value={costo} onChange={setCosto} decimal step={5} placeholder="—" /></div>
          </div>
          <label className="fl">Data</label>
          <input className="txt" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <label className="fl">Fornitore</label>
          <SupplierPicker value={forn} onChange={setForn} />
          <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : 'Registra arrivo'}</button>
        </>
      )}
    </div>
  );
}
