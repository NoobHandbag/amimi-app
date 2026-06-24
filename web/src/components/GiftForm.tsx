import { useState } from 'react';
import ProductPicker from './ProductPicker';
import { writeApi, oggi } from '../lib/api';
import type { Product } from '../lib/api';

export default function GiftForm({ pin, chi }: { pin: string; chi: string }) {
  const [prod, setProd] = useState<Product | null>(null);
  const [qta, setQta] = useState('1');
  const [nome, setNome] = useState('');
  const [data, setData] = useState(oggi());
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null);

  async function submit() {
    if (!prod) return setMsg({ t: 'err', x: 'Scegli un prodotto' });
    if (!(Number(qta) > 0)) return setMsg({ t: 'err', x: 'Quantità non valida' });
    setBusy(true); setMsg(null);
    const d = new Date(data);
    try {
      await writeApi('gift', {
        codice: prod.codice, item: prod.item, variant: prod.variant, quantita: Number(qta),
        nome: nome || null, nota: nota || null, data, year: d.getFullYear(), month: d.getMonth() + 1, kind: 'gift',
      }, pin, chi);
      setMsg({ t: 'ok', x: `Regalo registrato · ${prod.item} ×${qta}` });
      setProd(null); setQta('1'); setNome(''); setNota('');
    } catch (e) {
      setMsg({ t: 'err', x: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div className="form">
      <label className="fl">Prodotto</label>
      <ProductPicker selected={prod} onPick={(p) => { setProd(p); setMsg(null); }} />
      {prod && (
        <>
          <div className="grid2">
            <div><label className="fl">Quantità</label>
              <input className="num" type="number" inputMode="numeric" value={qta} onChange={(e) => setQta(e.target.value)} /></div>
            <div><label className="fl">Data</label>
              <input className="txt" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
          </div>
          <label className="fl">A chi (facoltativo)</label>
          <input className="txt" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="nome destinatario" />
          <label className="fl">Nota</label>
          <input className="txt" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="es. campione stampa" />
          <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : 'Registra regalo'}</button>
        </>
      )}
      {msg && <div className={`msg ${msg.t}`}>{msg.x}</div>}
    </div>
  );
}
