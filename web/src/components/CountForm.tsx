import { useEffect, useState } from 'react';
import ProductPicker from './ProductPicker';
import NumberStepper from './NumberStepper';
import { writeApi, fetchGiacenze, oggi } from '../lib/api';
import type { Product } from '../lib/api';
import { toast } from '../lib/toast';

export default function CountForm({ pin, chi }: { pin: string; chi: string }) {
  const [prod, setProd] = useState<Product | null>(null);
  const [giac, setGiac] = useState<Map<string, number>>(new Map());
  const [contati, setContati] = useState('');
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchGiacenze().then(setGiac); }, []);

  const sys = prod ? (giac.get(prod.codice) ?? 0) : null;
  const delta = prod && contati !== '' ? Number(contati) - (sys ?? 0) : null;

  async function submit() {
    if (!prod) return toast('Scegli un prodotto', 'err');
    if (contati === '' || isNaN(Number(contati))) return toast('Inserisci i pezzi contati', 'err');
    setBusy(true);
    try {
      await writeApi('count', {
        codice: prod.codice, modello: prod.item, variante: prod.variant,
        contati: Number(contati), giac_snapshot: sys, delta,
        data_conta: oggi(), nota: nota || null, stato: 'da verificare',
      }, pin, chi);
      toast(`Conta salvata · ${prod.item} ${prod.variant ?? ''} = ${contati} (delta ${delta! >= 0 ? '+' : ''}${delta})`, 'ok');
      setProd(null); setContati(''); setNota('');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form">
      <label className="fl">Prodotto</label>
      <ProductPicker selected={prod} onPick={(p) => setProd(p)} />

      {prod && (
        <>
          <div className="sysrow">
            <span>Il sistema dice</span>
            <b className={(sys ?? 0) <= 0 ? 'neg' : ''}>{sys} pz</b>
          </div>
          <label className="fl">Pezzi contati</label>
          <NumberStepper value={contati} onChange={setContati} min={0} placeholder="0" />
          {delta !== null && contati !== '' && (
            <div className={`deltabadge ${delta === 0 ? 'ok' : delta < 0 ? 'neg' : 'pos'}`}>
              {delta === 0 ? 'Combacia ✓' : `Delta ${delta > 0 ? '+' : ''}${delta} ${delta < 0 ? '(ammanco)' : '(in più)'}`}
            </div>
          )}
          <label className="fl">Nota (facoltativa)</label>
          <input className="txt" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="es. scaffale A" />
          <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : 'Salva conta'}</button>
        </>
      )}
    </div>
  );
}
