import { useState } from 'react';
import ProductPicker from './ProductPicker';
import NegozioPicker from './NegozioPicker';
import { writeApi, oggi } from '../lib/api';
import type { Product } from '../lib/api';

const TIPI: [string, string][] = [['invio', 'Invio'], ['venduto', 'Venduto'], ['reso', 'Reso']];
const MODELLI: [string, string][] = [['conto_vendita', 'Conto vendita'], ['wholesale', 'Wholesale']];

export default function B2BForm({ pin, chi }: { pin: string; chi: string }) {
  const [prod, setProd] = useState<Product | null>(null);
  const [tipo, setTipo] = useState('invio');
  const [modello, setModello] = useState('conto_vendita');
  const [negozio, setNegozio] = useState('');
  const [qta, setQta] = useState('1');
  const [prezzo, setPrezzo] = useState('');
  const [perc, setPerc] = useState('0.5');
  const [data, setData] = useState(oggi());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null);

  async function submit() {
    if (!prod) return setMsg({ t: 'err', x: 'Scegli un prodotto' });
    if (!negozio) return setMsg({ t: 'err', x: 'Scegli il negozio' });
    if (!(Number(qta) > 0)) return setMsg({ t: 'err', x: 'Quantità non valida' });
    setBusy(true); setMsg(null);
    const d = new Date(data);
    try {
      await writeApi('b2b', {
        codice: prod.codice, quantita: Number(qta), modello, tipo_movimento: tipo, negozio,
        prezzo_retail: prezzo === '' ? (prod.retail_price ?? null) : Number(prezzo),
        perc_negozio: Number(perc), data, year: d.getFullYear(), month: d.getMonth() + 1,
      }, pin, chi);
      setMsg({ t: 'ok', x: `Movimento B2B salvato · ${tipo} ${qta}× ${prod.item} @ ${negozio}` });
      setProd(null); setQta('1'); setPrezzo('');
    } catch (e) {
      setMsg({ t: 'err', x: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div className="form">
      <label className="fl">Prodotto</label>
      <ProductPicker selected={prod} onPick={(p) => { setProd(p); setPrezzo(p ? String(p.retail_price ?? '') : ''); setMsg(null); }} />
      {prod && (
        <>
          <label className="fl">Tipo movimento</label>
          <div className="supgrid">{TIPI.map(([k, l]) => <button key={k} type="button" className={`supcard ${tipo === k ? 'on' : ''}`} onClick={() => setTipo(k)}>{l}</button>)}</div>
          <label className="fl">Modello</label>
          <div className="supgrid">{MODELLI.map(([k, l]) => <button key={k} type="button" className={`supcard ${modello === k ? 'on' : ''}`} onClick={() => setModello(k)}>{l}</button>)}</div>
          <label className="fl">Negozio</label>
          <NegozioPicker value={negozio} onChange={setNegozio} />
          <div className="grid2">
            <div><label className="fl">Quantità</label>
              <input className="num" type="number" inputMode="numeric" value={qta} onChange={(e) => setQta(e.target.value)} /></div>
            <div><label className="fl">Prezzo retail €</label>
              <input className="num" type="number" inputMode="decimal" value={prezzo} onChange={(e) => setPrezzo(e.target.value)} /></div>
          </div>
          <label className="fl">% negozio (0–1)</label>
          <input className="txt" type="number" inputMode="decimal" step="0.05" value={perc} onChange={(e) => setPerc(e.target.value)} />
          <label className="fl">Data</label>
          <input className="txt" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : 'Salva movimento B2B'}</button>
        </>
      )}
      {msg && <div className={`msg ${msg.t}`}>{msg.x}</div>}
    </div>
  );
}
