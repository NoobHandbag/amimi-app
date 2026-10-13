import { useState } from 'react';
import ProductPicker from './ProductPicker';
import NumberStepper from './NumberStepper';
import { writeApi, oggi } from '../lib/api';
import type { Product } from '../lib/api';
import { toast } from '../lib/toast';
import Icon from './Icon';

const PAGAMENTI = ['Contanti', 'PayPal', 'Bonifico', 'Revolut', 'Altro'];

// gifts_offline tiene i regali (kind 'gift', SEMPRE prezzo 0: vincolo gifts_offline_gift_senza_prezzo, migr 0156)
// e le vendite manuali fuori Qromo/Shopify (kind 'vendita_manuale', prezzo + metodo di pagamento). Nessuna delle due
// entra nel CE Amimi'; nel CE Totale la vendita e' ricavo e conta nel compenso soci, il regalo pesa solo come costo.
// Fino al 13-10 il Regalo accettava un prezzo ("soldi fuori dal fatturato", call 06-07): soldi entrati = Vendita.
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

  const isVendita = tipo === 'vendita';

  async function submit() {
    if (!prod) return toast('Scegli un prodotto', 'err');
    if (!(Number(qta) > 0)) return toast('Quantità non valida', 'err');
    if (isVendita && !(Number(prezzo) > 0)) return toast('Inserisci il prezzo della vendita', 'err');
    setBusy(true);
    const d = new Date(data);
    try {
      await writeApi('gift', {
        codice: prod.codice, item: prod.item, variant: prod.variant, quantita: Number(qta),
        nome: nome || null, nota: nota || null, data, year: d.getFullYear(), month: d.getMonth() + 1,
        kind: isVendita ? 'vendita_manuale' : 'gift',
        prezzo: isVendita ? Number(prezzo) : 0,
        payment_method: isVendita ? pagamento : 'GIFT',
      }, pin, chi);
      toast(isVendita ? `Vendita registrata · ${prod.item} ×${qta} · €${prezzo}` : `Regalo registrato · ${prod.item} ×${qta}`, 'ok');
      setProd(null); setQta('1'); setPrezzo(''); setNome(''); setNota('');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally { setBusy(false); }
  }

  return (
    <div className="form">
      <div className="ds-seg full">
        <button type="button" className={tipo === 'gift' ? 'on' : ''} onClick={() => setTipo('gift')}><Icon name="gift" size={16} /> Regalo</button>
        <button type="button" className={tipo === 'vendita' ? 'on' : ''} onClick={() => setTipo('vendita')}><Icon name="euro" size={16} /> Vendita manuale</button>
      </div>
      <p className="ds-modehint">{isVendita ? 'Vendita offline fuori Qromo: scala l’inventario, con prezzo e metodo di pagamento.' : 'Regalo o campione, senza incasso: scala l’inventario. Se sono entrati dei soldi è una vendita: usa Vendita manuale.'}</p>

      <label className="fl">Prodotto</label>
      <ProductPicker selected={prod} onPick={(p) => setProd(p)} />
      {prod && (
        <>
          <div className="grid2">
            <div><label className="fl">Quantità</label><NumberStepper value={qta} onChange={setQta} min={1} /></div>
            <div><label className="fl">Data</label>
              <input className="num" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
          </div>

          {isVendita && (
            <>
              <div className="grid2">
                <div><label className="fl">Prezzo € (IVA incl.)</label><NumberStepper value={prezzo} onChange={setPrezzo} decimal step={5} placeholder="0,00" /></div>
                <div><label className="fl">Pagamento</label>
                  <select className="num" value={pagamento} onChange={(e) => setPagamento(e.target.value)}>
                    {PAGAMENTI.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select></div>
              </div>
              <p className="note">La vendita manuale scala l'inventario ed entra nel CE Totale (non nel CE Amimì) e nella base del compenso soci.</p>
            </>
          )}

          <label className="fl">{isVendita ? 'Cliente (facoltativo)' : 'A chi (facoltativo)'}</label>
          <input className="txt" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={isVendita ? 'nome cliente' : 'nome destinatario'} />
          <label className="fl">Nota</label>
          <input className="txt" value={nota} onChange={(e) => setNota(e.target.value)} placeholder={isVendita ? 'es. vendita evento' : 'es. campione stampa'} />
          <button className="ds-btn primary full" style={{ marginTop: 18 }} disabled={busy} onClick={submit}>{busy ? 'Salvo…' : isVendita ? 'Registra vendita' : 'Registra regalo'}</button>
        </>
      )}
    </div>
  );
}
