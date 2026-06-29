import { useEffect, useMemo, useState } from 'react';
import NumberStepper from './NumberStepper';
import { writeApi, fetchInventory, clearProductCache } from '../lib/api';
import type { InvFull } from '../lib/api';
import { suggestPrice, marginOf } from '../lib/helpers';
import { toast } from '../lib/toast';

const CATS = ['BAG', 'PELLE', 'TESSUTO', 'ACCESSORI', 'ALTRO'];
const modelTok = (s: string) => s.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
const variantTok = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');

export default function NewProductForm({ pin, chi }: { pin: string; chi: string }) {
  const [inv, setInv] = useState<InvFull[]>([]);
  const [mq, setMq] = useState('');
  const [model, setModel] = useState('');
  const [typingModel, setTypingModel] = useState(false);
  const [variant, setVariant] = useState('');
  const [cat, setCat] = useState('BAG');
  const [price, setPrice] = useState('');
  const [cogs, setCogs] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchInventory().then(setInv).catch(() => {}); }, []);
  const ds = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);
  // #4: show models that are active (stock or sold in 90d) by default; searching reveals all (old too)
  const shownModels = useMemo(() => {
    const all = new Set<string>(); const active = new Set<string>();
    for (const p of inv) { if (!p.item) continue; all.add(p.item); if (p.giacenza_attuale > 0 || ds(p.last_sale) <= 90) active.add(p.item); }
    const allM = [...all].sort();
    const s = mq.trim().toLowerCase();
    return s ? allM.filter((m) => m.toLowerCase().includes(s)) : allM.filter((m) => active.has(m));
  }, [inv, mq]);

  const codice = useMemo(() => (model && variant ? `${modelTok(model)}_${variantTok(variant)}` : ''), [model, variant]);
  const valid = !!codice && !/\s/.test(codice) && !/_$/.test(codice);

  async function submit() {
    if (!model) return toast('Scegli o scrivi il modello', 'err');
    if (!variant) return toast('Inserisci la variante', 'err');
    if (!valid) return toast('CODICE non valido', 'err');
    setBusy(true);
    try {
      await writeApi('product', {
        codice, model, item: model, variant: variantTok(variant), categoria: cat,
        retail_price: price === '' ? null : Number(price), cogs: cogs === '' ? null : Number(cogs),
      }, pin, chi);
      toast(`Prodotto creato · ${codice}`, 'ok');
      clearProductCache();
      setVariant(''); setPrice(''); setCogs('');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally { setBusy(false); }
  }

  return (
    <div className="form">
      <label className="fl">Modello</label>
      {typingModel ? (
        <input className="txt" value={model} onChange={(e) => setModel(e.target.value)} placeholder="es. Lea Bag" autoFocus />
      ) : (
        <>
          <input className="search" placeholder="Cerca modello…" value={mq} onChange={(e) => setMq(e.target.value)} />
          <div className="supgrid">
            {shownModels.map((m) => (
              <button key={m} type="button" className={`supcard ${model === m ? 'on' : ''}`} onClick={() => setModel(m)}>{m}</button>
            ))}
            <button type="button" className="supcard alt" onClick={() => { setTypingModel(true); setModel(''); }}>+ nuovo</button>
          </div>
        </>
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
        <div><label className="fl">Prezzo € (IVA incl.)</label><NumberStepper value={price} onChange={setPrice} decimal step={5} placeholder="—" /></div>
        <div><label className="fl">COGS €</label><NumberStepper value={cogs} onChange={setCogs} decimal step={5} placeholder="—" /></div>
      </div>
      {Number(cogs) > 0 ? (() => { const sug = suggestPrice(Number(cogs)); return (
        <button type="button" className="hintchip" onClick={() => setPrice(String(sug))}>
          💡 Prezzo consigliato €{sug.toFixed(2)} · margine {Math.round(marginOf(sug, Number(cogs)) * 100)}%
        </button>); })() : null}

      <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : 'Crea prodotto'}</button>
    </div>
  );
}
