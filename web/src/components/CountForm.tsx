import { useEffect, useState } from 'react';
import ProductPicker from './ProductPicker';
import NumberStepper from './NumberStepper';
import { writeApi, fetchGiacenzaOne, fetchProducts, oggi } from '../lib/api';
import type { Product } from '../lib/api';
import { toast } from '../lib/toast';

export default function CountForm({ pin, chi, initialCodice }: { pin: string; chi: string; initialCodice?: string }) {
  const [prod, setProd] = useState<Product | null>(null);
  // arrivo dalla scheda prodotto in magazzino (item 3): prodotto gia' selezionato
  useEffect(() => {
    if (!initialCodice) return;
    let alive = true;
    fetchProducts().then((ps) => { if (alive) { const p = ps.find((x) => x.codice === initialCodice); if (p) setProd(p); } }).catch(() => {});
    return () => { alive = false; };
  }, [initialCodice]);
  const [sys, setSys] = useState<number | null>(null);
  const [loadingSys, setLoadingSys] = useState(false);
  const [contati, setContati] = useState('');
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);

  // Read the selected product's LIVE giacenza on every selection, so an immediate re-count of the
  // same product is never stale (the server recomputes too, this just keeps the shown number honest).
  useEffect(() => {
    if (!prod) { setSys(null); return; }
    let alive = true;
    setSys(null); setLoadingSys(true);
    fetchGiacenzaOne(prod.codice)
      .then((g) => { if (alive) setSys(g); })
      .finally(() => { if (alive) setLoadingSys(false); });
    return () => { alive = false; };
  }, [prod]);

  const delta = prod && contati !== '' && sys !== null ? Number(contati) - sys : null;

  async function submit() {
    if (!prod) return toast('Scegli un prodotto', 'err');
    if (sys === null) return toast('Attendi la giacenza…', 'err');
    if (contati === '' || isNaN(Number(contati))) return toast('Inserisci i pezzi contati', 'err');
    const d = Number(contati) - sys;
    // guard: big rectifications need an explicit confirm (fat-finger protection)
    if (Math.abs(d) >= 5 && !window.confirm(
      `Stai per correggere la giacenza di ${prod.item ?? prod.codice} ${prod.variant ?? ''} da ${sys} a ${contati} pezzi (${d > 0 ? '+' : ''}${d}). Confermi?`
    )) return;
    setBusy(true);
    try {
      const res = await writeApi('count', {
        codice: prod.codice, modello: prod.item, variante: prod.variant,
        contati: Number(contati), data_conta: oggi(), nota: nota || null,
      }, pin, chi) as unknown as { delta?: number; giac_dopo?: number };
      const dl = res.delta ?? d;
      toast(dl === 0
        ? `Conta combacia · ${prod.item ?? prod.codice}: nessuna rettifica`
        : `Giacenza corretta · ${prod.item ?? ''} ${prod.variant ?? ''} ora = ${res.giac_dopo ?? contati} (${dl > 0 ? '+' : ''}${dl})`, 'ok');
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
            <b className={sys !== null && sys <= 0 ? 'neg' : ''}>{loadingSys || sys === null ? '…' : `${sys} pz`}</b>
          </div>
          <label className="fl">Pezzi contati</label>
          <NumberStepper value={contati} onChange={setContati} min={0} placeholder="0" />
          {delta !== null && contati !== '' && (
            <>
              <div className={`deltabadge ${delta === 0 ? 'ok' : delta < 0 ? 'neg' : 'pos'}`}>
                {delta === 0 ? 'Combacia ✓' : `Delta ${delta > 0 ? '+' : ''}${delta} ${delta < 0 ? '(ammanco)' : '(in più)'}`}
              </div>
              {delta !== 0 && <p className="note">La giacenza verrà corretta da {sys} a {contati} pezzi.</p>}
            </>
          )}
          <label className="fl">Nota (facoltativa)</label>
          <input className="txt" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="es. scaffale A" />
          <button className="submit" disabled={busy || loadingSys} onClick={submit}>{busy ? 'Applico…' : 'Applica conta'}</button>
        </>
      )}
    </div>
  );
}
