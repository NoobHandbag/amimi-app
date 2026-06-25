import { useState } from 'react';
import ProductPicker from './ProductPicker';
import { writeApi, oggi } from '../lib/api';
import type { Product } from '../lib/api';

const PAGAMENTI = ['Contanti', 'PayPal', 'Bonifico', 'Revolut', 'Altro'];

// GIFT_OFFLINE serve sia per i regali (prezzo 0) sia per le vendite manuali offline fuori Qromo
// (con prezzo + metodo pagamento), come il form AppSheet. Nota: oggi il CE conta come ricavo solo
// Shopify+Qromo+B2B, NON i GIFT_OFFLINE: la vendita manuale incide sull'inventario ma non sul P&L
// finché non decidiamo di includerla (vedi nota in chat).
export default function GiftForm({ pin, chi }: { pin: string; chi: string }) {
  const [tipo, setTipo] = useState<'gift' | 'vendita'>('gift');
  const [prod, setProd] = useState<Product | null>(null);
  const [qta, setQta] = useState('1');
  const [prezzo, setPrezzo] = useState('');
  const [pagamento, setPagamento] = useState('Contanti');
  const [nome, setNome] = useState('');
  const [data, setData] = useState(oggi());
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null);

  const isVendita = tipo === 'vendita';

  async function submit() {
    if (!prod) return setMsg({ t: 'err', x: 'Scegli un prodotto' });
    if (!(Number(qta) > 0)) return setMsg({ t: 'err', x: 'Quantità non valida' });
    if (isVendita && !(Number(prezzo) > 0)) return setMsg({ t: 'err', x: 'Inserisci il prezzo della vendita' });
    setBusy(true); setMsg(null);
    const d = new Date(data);
    try {
      await writeApi('gift', {
        codice: prod.codice, item: prod.item, variant: prod.variant, quantita: Number(qta),
        nome: nome || null, nota: nota || null, data, year: d.getFullYear(), month: d.getMonth() + 1,
        kind: isVendita ? 'vendita_manuale' : 'gift',
        prezzo: isVendita ? Number(prezzo) : 0,
        payment_method: isVendita ? pagamento : 'GIFT',
      }, pin, chi);
      setMsg({ t: 'ok', x: isVendita ? `Vendita registrata · ${prod.item} ×${qta} · €${prezzo}` : `Regalo registrato · ${prod.item} ×${qta}` });
      setProd(null); setQta('1'); setPrezzo(''); setNome(''); setNota('');
    } catch (e) {
      setMsg({ t: 'err', x: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div className="form">
      <div className="seg">
        <button className={tipo === 'gift' ? 'on' : ''} onClick={() => setTipo('gift')}>🎁 Regalo</button>
        <button className={tipo === 'vendita' ? 'on' : ''} onClick={() => setTipo('vendita')}>💶 Vendita manuale</button>
      </div>

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

          {isVendita && (
            <>
              <div className="grid2">
                <div><label className="fl">Prezzo € (IVA incl.)</label>
                  <input className="num" type="number" inputMode="decimal" value={prezzo} onChange={(e) => setPrezzo(e.target.value)} placeholder="0,00" /></div>
                <div><label className="fl">Pagamento</label>
                  <select className="num" value={pagamento} onChange={(e) => setPagamento(e.target.value)}>
                    {PAGAMENTI.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select></div>
              </div>
              <p className="note">La vendita manuale scala l’inventario. Nota: oggi non entra nel P&L (il CE conta solo Shopify/Qromo/B2B) — da decidere se includerla.</p>
            </>
          )}

          <label className="fl">{isVendita ? 'Cliente (facoltativo)' : 'A chi (facoltativo)'}</label>
          <input className="txt" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={isVendita ? 'nome cliente' : 'nome destinatario'} />
          <label className="fl">Nota</label>
          <input className="txt" value={nota} onChange={(e) => setNota(e.target.value)} placeholder={isVendita ? 'es. vendita evento' : 'es. campione stampa'} />
          <button className="submit" disabled={busy} onClick={submit}>{busy ? 'Salvo…' : isVendita ? 'Registra vendita' : 'Registra regalo'}</button>
        </>
      )}
      {msg && <div className={`msg ${msg.t}`}>{msg.x}</div>}
    </div>
  );
}
