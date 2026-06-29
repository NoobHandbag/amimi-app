import { useEffect, useMemo, useState } from 'react';
import { writeApi, fetchProducts, clearProductCache } from '../lib/api';
import { suggestPrice, marginOf } from '../lib/helpers';

const CATS = ['BAG', 'PELLE', 'TESSUTO', 'ACCESSORI', 'ALTRO'];
const modelTok = (s: string) => s.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
const variantTok = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');

export default function NewProductForm({ pin, chi }: { pin: string; chi: string }) {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [typingModel, setTypingModel] = useState(false);
  const [variant, setVariant] = useState('');
  const [cat, setCat] = useState('BAG');
  const [price, setPrice] = useState('');
  const [cogs, setCogs] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null);

  useEffect(() => {
    fetchProducts().then((ps) => {
      const m = [...new Set(ps.map((p) => p.item).filter((x): x is string => !!x))].sort();
      setModels(m);
    }).catch(() => {});
  }, []);

  const codice = useMemo(() => (model && variant ? `${modelTok(model)}_${variantTok(variant)}` : ''), [model, variant]);
  const valid = !!codice && !/\s/.test(codice) && !/_$/.test(codice);

  async function submit() {
    if (!model) return setMsg({ t: 'err', x: 'Scegli o scrivi il modello' });
    if (!variant) return setMsg({ t: 'err', x: 'Inserisci la variante' });
    if (!valid) return setMsg({ t: 'err', x: 'CODICE non valido' });
    setBusy(true); setMsg(null);
    try {
      await writeApi('product', {
        codice, model, item: model, variant: variantTok(variant), categoria: cat,
        retail_price: price === '' ? null : Number(price), cogs: cogs === '' ? null : Number(cogs),
      }, pin, chi);
      setMsg({ t: 'ok', x: `Prodotto creato · ${codice}` });
      clearProductCache();
      setVariant(''); setPrice(''); setCogs('');
    } catch (e) {
      setMsg({ t: 'err', x: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div className="form">
      <label className="fl">Modello</label>
      {typingModel ? (
        <input className="txt" value={model} onChange={(e) => setModel(e.target.value)} placeholder="es. Lea Bag" autoFocus />
      ) : (
        <div className="supgrid">
          {models.map((m) => (
            <button key={m} type="button" className={`supcard ${model === m ? 'on' : ''}`} onClick={() => setModel(m)}>{m}</button>
          ))}
          <button type="button" className="supcard alt" onClick={() => { setTypingModel(true); setModel(''); }}>+ nuovo</button>
        </div>
      )}

      <label className="fl">Variante</label>
      <input className="txt" value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="es. COCCO ROSSO" />

      {(model || variant) && (
        <div className={`codicebox ${codice && !valid ? 'bad' : ''}`}>
          <span>{codice || '—'}</span>
          <span>{valid ? '✓' : codice ? '✗' : ''}</span>
        </div>
      )}

      <label className="fl">Categoria</label>
      <div className="supgrid">
        {CATS.map((c) => <button key={c} type="button" className={`supcard ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>

      <div className="grid2">
        <div><label className="fl">Prezzo € (IVA incl.)</label>
          <input className="num" type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="—" /></div>
        <div><label className="fl">COGS €</label>
          <input className="num" type="number" inputMode="decimal" value={cogs} onChange={(e) => setCogs(e.target.value)} placeholder="—" /></div>
      </div>
      {Number(cogs) > 0 ? (() => { const sug = suggestPrice(Number(cogs)); return (
        <button type="button" className="hintchip" onClick={() => setPrice(String(sug))}>
          💡 Prezzo consigliato €{sug.toFixed(2)} · margine {Math.round(marginOf(sug, Number(cogs)) * 100)}%
        </button>); })() : null}

      <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : 'Crea prodotto'}</button>
      {msg && <div className={`msg ${msg.t}`}>{msg.x}</div>}
    </div>
  );
}
