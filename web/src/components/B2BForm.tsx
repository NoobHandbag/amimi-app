import { useState } from 'react';
import ProductPicker from './ProductPicker';
import NegozioPicker from './NegozioPicker';
import NumberStepper from './NumberStepper';
import { writeApi, oggi } from '../lib/api';
import type { Product } from '../lib/api';
import { toast } from '../lib/toast';

const TIPI: [string, string][] = [['invio', 'Invio'], ['venduto', 'Venduto'], ['reso', 'Reso']];
const MODELLI: [string, string][] = [['conto_vendita', 'Conto vendita'], ['wholesale', 'Wholesale']];

export default function B2BForm({ pin, chi, initialNegozio }: { pin: string; chi: string; initialNegozio?: string }) {
  const [prod, setProd] = useState<Product | null>(null);
  const [tipo, setTipo] = useState(initialNegozio ? 'venduto' : 'invio');
  const [modello, setModello] = useState('conto_vendita');
  const [negozio, setNegozio] = useState(initialNegozio ?? '');
  const [qta, setQta] = useState('1');
  const [prezzo, setPrezzo] = useState('');
  const [perc, setPerc] = useState('0.5');
  const [data, setData] = useState(oggi());
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!prod) return toast('Scegli un prodotto', 'err');
    if (!negozio) return toast('Scegli il negozio', 'err');
    if (!(Number(qta) > 0)) return toast('Quantità non valida', 'err');
    setBusy(true);
    const d = new Date(data);
    try {
      await writeApi('b2b', {
        codice: prod.codice, quantita: Number(qta), modello, tipo_movimento: tipo, negozio,
        prezzo_retail: prezzo === '' ? (prod.retail_price ?? null) : Number(prezzo),
        perc_negozio: Number(perc), data, year: d.getFullYear(), month: d.getMonth() + 1,
      }, pin, chi);
      toast(`Movimento B2B salvato · ${tipo} ${qta}× ${prod.item} @ ${negozio}`, 'ok');
      setProd(null); setQta('1'); setPrezzo('');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally { setBusy(false); }
  }

  return (
    <div className="form">
      <label className="fl">Prodotto</label>
      <ProductPicker selected={prod} onPick={(p) => { setProd(p); setPrezzo(p ? String(p.retail_price ?? '') : ''); }} />
      {prod && (
        <>
          <label className="fl">Tipo movimento</label>
          <div className="supgrid">{TIPI.map(([k, l]) => <button key={k} type="button" className={`supcard ${tipo === k ? 'on' : ''}`} onClick={() => setTipo(k)}>{l}</button>)}</div>
          <label className="fl">Modello</label>
          <div className="supgrid">{MODELLI.map(([k, l]) => <button key={k} type="button" className={`supcard ${modello === k ? 'on' : ''}`} onClick={() => setModello(k)}>{l}</button>)}</div>
          <label className="fl">Negozio</label>
          <NegozioPicker value={negozio} onChange={setNegozio} />
          <div className="grid2">
            <div><label className="fl">Quantità</label><NumberStepper value={qta} onChange={setQta} min={1} /></div>
            <div><label className="fl">Prezzo retail €</label><NumberStepper value={prezzo} onChange={setPrezzo} decimal step={5} placeholder="0,00" /></div>
          </div>
          <label className="fl">% negozio (0–1)</label>
          <NumberStepper value={perc} onChange={setPerc} decimal step={0.05} />
          <label className="fl">Data</label>
          <input className="txt" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : 'Salva movimento B2B'}</button>
        </>
      )}
    </div>
  );
}
