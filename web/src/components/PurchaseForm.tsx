import { useState } from 'react';
import ProductPicker from './ProductPicker';
import SupplierPicker from './SupplierPicker';
import { writeApi, oggi, fetchLastPurchase } from '../lib/api';
import type { Product } from '../lib/api';

export default function PurchaseForm({ pin, chi }: { pin: string; chi: string }) {
  const [prod, setProd] = useState<Product | null>(null);
  const [qta, setQta] = useState('');
  const [costo, setCosto] = useState('');
  const [data, setData] = useState(oggi());
  const [forn, setForn] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null);

  function onPick(p: Product | null) {
    setProd(p); setMsg(null); setHint(null);
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
    if (!prod) return setMsg({ t: 'err', x: 'Scegli un prodotto' });
    if (!(Number(qta) > 0)) return setMsg({ t: 'err', x: 'Quantità non valida' });
    setBusy(true); setMsg(null);
    try {
      await writeApi('purchase', {
        codice: prod.codice, item: prod.item, variant: prod.variant, categoria: prod.categoria ?? 'BAG',
        tipologia: 'Prodotto Finito', unita_misura: 'Pezzi',
        quantita: Number(qta), costo_unitario: costo === '' ? null : Number(costo),
        data, fornitore: forn || null,
      }, pin, chi);
      setMsg({ t: 'ok', x: `Arrivo registrato · ${prod.item} ${prod.variant ?? ''} ×${qta}` });
      setProd(null); setQta(''); setCosto(''); setForn('');
    } catch (e) {
      setMsg({ t: 'err', x: (e as Error).message });
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
            <div><label className="fl">Quantità</label>
              <input className="num" type="number" inputMode="numeric" value={qta} onChange={(e) => setQta(e.target.value)} placeholder="0" /></div>
            <div><label className="fl">Costo unit. €</label>
              <input className="num" type="number" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="—" /></div>
          </div>
          <label className="fl">Data</label>
          <input className="txt" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <label className="fl">Fornitore</label>
          <SupplierPicker value={forn} onChange={setForn} />
          <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : 'Registra arrivo'}</button>
        </>
      )}
      {msg && <div className={`msg ${msg.t}`}>{msg.x}</div>}
    </div>
  );
}
