import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import ProductPicker from '../components/ProductPicker';
import {
  fetchProductsTodo, verifyProduct, fetchSalesByCodice, correctSale, clearProductCache, fetchProducts,
} from '../lib/api';
import type { ProdTodo, SaleRow, Product } from '../lib/api';
import { suggestPrice, marginOf, genSeoTitle } from '../lib/helpers';
import { PersonaPicker } from '../lib/people';
import { exportCSV } from '../lib/csv';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const CATS = ['BAG', 'PELLE', 'TESSUTO', 'ACCESSORI', 'ALTRO'];

/* ---------- Da completare (Benedetta) ---------- */
function ProdEdit({ p, pin, chi, onDone }: { p: ProdTodo; pin: string; chi: string; onDone: () => void }) {
  const [item, setItem] = useState(p.item ?? '');
  const [variant, setVariant] = useState(p.variant ?? '');
  const [cat, setCat] = useState(p.categoria ?? 'BAG');
  const [price, setPrice] = useState(p.retail_price != null ? String(p.retail_price) : '');
  const [img, setImg] = useState(p.image_url ?? '');
  const [descr, setDescr] = useState(p.description ?? '');
  const [seo, setSeo] = useState(p.seo_title ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!item.trim() || !variant.trim()) return setErr('Modello e variante sono obbligatori');
    setBusy(true); setErr(null);
    try {
      await verifyProduct({ codice: p.codice, item, variant, categoria: cat, retail_price: price === '' ? null : Number(price), image_url: img, description: descr, seo_title: seo }, pin, chi);
      clearProductCache(); onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <div className="form">
      <button className="back" onClick={onDone}>← {p.codice}</button>
      <div className="grid2">
        <div><label className="fl">Modello *</label><input className="txt" value={item} onChange={(e) => setItem(e.target.value)} /></div>
        <div><label className="fl">Variante *</label><input className="txt" value={variant} onChange={(e) => setVariant(e.target.value)} /></div>
      </div>
      <label className="fl">Categoria</label>
      <div className="supgrid">{CATS.map((c) => <button key={c} type="button" className={`supcard ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}</div>
      <div className="grid2">
        <div><label className="fl">Prezzo € (IVA incl.)</label><input className="num" type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div><label className="fl">Immagine (URL)</label><input className="txt" value={img} onChange={(e) => setImg(e.target.value)} placeholder="https://…" /></div>
      </div>
      {p.cogs ? (() => { const sug = suggestPrice(p.cogs!); return (
        <button type="button" className="hintchip" onClick={() => setPrice(String(sug))}>
          💡 Prezzo consigliato €{sug.toFixed(2)} · margine {Math.round(marginOf(sug, p.cogs!) * 100)}% (COGS €{p.cogs})
        </button>); })() : null}
      <label className="fl">Descrizione</label>
      <input className="txt" value={descr} onChange={(e) => setDescr(e.target.value)} placeholder="—" />
      <div className="lblrow"><label className="fl">SEO title</label>
        <button type="button" className="minibtn" onClick={() => setSeo(genSeoTitle(item, variant))} disabled={!item || !variant}>genera</button></div>
      <input className="txt" value={seo} onChange={(e) => setSeo(e.target.value)} placeholder="Borsa … AMIMI … Made in Italy" />
      {seo && <div className="charcount">{seo.length} caratteri{seo.length >= 60 && seo.length <= 70 ? ' ✓' : ' (target 60–70)'}</div>}
      <button className="submit" disabled={busy} onClick={save}>{busy ? 'Salvo…' : '✓ Verifica e salva'}</button>
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

function ProdVerify({ pin, chi }: { pin: string; chi: string }) {
  const [list, setList] = useState<ProdTodo[]>([]);
  const [edit, setEdit] = useState<ProdTodo | null>(null);
  const load = () => fetchProductsTodo().then(setList).catch(() => {});
  useEffect(() => { load(); }, []);
  if (edit) return <ProdEdit p={edit} pin={pin} chi={chi} onDone={() => { setEdit(null); load(); }} />;
  if (!list.length) return <div className="card muted center">Tutti i prodotti sono verificati. 🎉</div>;
  const miss = (p: ProdTodo) => [
    !p.item && 'MODELLO', !p.variant && 'VARIANTE', !p.image_url && 'IMG',
    (!p.retail_price && 'PREZZO'), !p.description && 'DESCR',
  ].filter(Boolean) as string[];
  return (
    <div className="list">
      <p className="note">{list.length} prodotti da completare. In alto quelli che già vendono.</p>
      {list.map((p) => (
        <button key={p.codice} className="todocard" onClick={() => setEdit(p)}>
          <div className="invimg sm">{p.image_url ? <img src={p.image_url} alt="" /> : <span>{(p.item ?? p.codice).slice(0, 2)}</span>}</div>
          <div className="todoinfo">
            <div className="rt">{[p.item, p.variant].filter(Boolean).join(' ') || p.codice} {p.venduto > 0 && <span className="hot">venduto {p.venduto}×</span>}</div>
            <div className="missrow">{miss(p).map((m) => <span key={m} className="misschip">{m}</span>)}</div>
          </div>
          <span className="chev">›</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Correggi vendita (sale → product) ---------- */
function SaleCorrect({ pin, chi }: { pin: string; chi: string }) {
  const [orig, setOrig] = useState<Product | null>(null);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [sale, setSale] = useState<SaleRow | null>(null);
  const [target, setTarget] = useState<Product | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (orig) fetchSalesByCodice(orig.codice).then(setSales).catch(() => setSales([])); }, [orig]);

  async function apply() {
    if (!sale || !target) return;
    setBusy(true); setMsg(null);
    try {
      await correctSale({ source: sale.source, id: sale.id, new_codice: target.codice, new_item: target.item, new_variant: target.variant }, pin, chi);
      setMsg({ t: 'ok', x: `Vendita riassegnata a ${target.codice}. Magazzino aggiornato.` });
      setSale(null); setTarget(null); setOrig(null); setSales([]);
    } catch (e) { setMsg({ t: 'err', x: (e as Error).message }); } finally { setBusy(false); }
  }

  if (!orig) return (<div><p className="note">Quale prodotto era stato segnato per errore? Scegli l’originale, poi la vendita.</p><ProductPicker selected={null} onPick={setOrig} /></div>);
  if (!sale) return (
    <div>
      <button className="back" onClick={() => setOrig(null)}>← {orig.item ?? orig.codice}</button>
      {!sales.length ? <div className="card muted center">Nessuna vendita trovata per {orig.codice}.</div> : (
        <div className="list">{sales.map((s) => (
          <button key={s.source + s.id} className="salerow" onClick={() => setSale(s)}>
            <div><div className="rt">{s.descr}</div><div className="rs">{s.source === 'qromo' ? 'Negozio' : 'Online'} · {s.data ?? ''} · {s.qty}× {s.price != null ? eur(s.price) : ''}</div></div>
            <span className="chev">›</span>
          </button>
        ))}</div>
      )}
      {msg && <div className={`msg ${msg.t}`}>{msg.x}</div>}
    </div>
  );
  return (
    <div>
      <button className="back" onClick={() => setSale(null)}>← vendita {sale.data}</button>
      <p className="note">Era <b>{orig.item ?? orig.codice}</b>. Qual era il prodotto reale?</p>
      <ProductPicker selected={target} onPick={setTarget} />
      {target && <button className="submit" disabled={busy} onClick={apply}>{busy ? '…' : `Riassegna a ${target.item ?? target.codice}`}</button>}
      {msg && <div className={`msg ${msg.t}`}>{msg.x}</div>}
    </div>
  );
}

/* ---------- Pubblica (gated) ---------- */
function Publish() {
  const [ready, setReady] = useState<{ codice: string; item: string | null; variant: string | null }[] | null>(null);
  useEffect(() => {
    (async () => {
      const inv = await supabase.from('v_inventory').select('codice,on_shopify');
      const onShop = new Set((inv.data ?? []).filter((r: { on_shopify: boolean }) => r.on_shopify).map((r: { codice: string }) => r.codice));
      const pr = await supabase.from('products').select('codice,item,variant,verificato').eq('verificato', true);
      setReady((pr.data ?? []).filter((p: { codice: string }) => !onShop.has(p.codice)).slice(0, 60));
    })();
  }, []);
  return (
    <div>
      <div className="card warn">
        <b>Pubblicazione live disattivata.</b> Quando un prodotto è verificato e pronto, si pubblica su Shopify + Qromo da qui.
        La scrittura su Shopify è dietro un interruttore lato server (<code>shopify_write_enabled</code>), ancora spento per sicurezza.
      </div>
      {ready == null ? <p className="muted center">…</p> : !ready.length ? <div className="card muted center">Nessun prodotto verificato in attesa di pubblicazione.</div> : (
        <div className="list">
          <p className="note">{ready.length} prodotti verificati non ancora su Shopify.</p>
          {ready.map((p) => (
            <div className="row" key={p.codice}>
              <div><div className="rt">{p.item ?? p.codice}</div><div className="rs">{p.variant ?? ''}</div></div>
              <button className="chip" disabled title="abilitazione lato server richiesta">pubblica</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Diagnostica (health-check) ---------- */
type Health = { k: string; label: string; n: number; severity: 'ok' | 'warn' | 'bad' };
function HealthCheck() {
  const [rows, setRows] = useState<Health[] | null>(null);
  const load = () => supabase.from('v_health').select('*').then(({ data }) => setRows((data ?? []) as Health[]));
  useEffect(() => { load(); }, []);
  if (rows == null) return <p className="muted center">Carico…</p>;
  const order = { bad: 0, warn: 1, ok: 2 } as Record<string, number>;
  const sorted = [...rows].sort((a, b) => order[a.severity] - order[b.severity] || b.n - a.n);
  const bad = rows.filter((r) => r.severity === 'bad' && r.n > 0).length;
  return (
    <div>
      <div className={`card ${bad ? 'warn' : ''}`} style={{ textAlign: 'center' }}>
        {bad ? <b>{bad} controlli da sistemare</b> : <b>✓ Nessun problema critico</b>}
        <div className="note" style={{ marginTop: 4 }}>Controlli automatici sulla qualità dei dati. Aggiornati ad ogni apertura.</div>
      </div>
      <div className="card"><div className="list">
        {sorted.map((r) => (
          <div className="diagrow" key={r.k}>
            <span className={`diagdot ${r.severity}`} />
            <div className="diaginfo"><div className="dt">{r.label}</div></div>
            <div className={`diagn ${r.severity}`}>{r.severity === 'ok' ? '✓' : r.n}</div>
          </div>
        ))}
      </div></div>
      <button className="syncbtn" onClick={load}>🔄 Ricontrolla</button>
    </div>
  );
}

const SUBS: [string, string][] = [['prod', 'Da completare'], ['pubblica', 'Pubblica'], ['vendite', 'Correggi vendita'], ['diag', 'Diagnostica']];

export default function Prodotti({ pin, chi, setChi, initial }: { pin: string; chi: string; setChi: (c: string) => void; initial?: string }) {
  const [sub, setSub] = useState<string>(initial && SUBS.some(([k]) => k === initial) ? initial : 'prod');
  const [cat, setCat] = useState<Product[]>([]);
  useEffect(() => { fetchProducts().then(setCat).catch(() => {}); }, []);
  return (
    <div className="screen">
      <header><h1>Prodotti</h1><div className="operbar"><button className="exp" type="button" onClick={() => exportCSV('prodotti', cat.map((p) => ({ codice: p.codice, modello: p.item, variante: p.variant, categoria: p.categoria, prezzo: p.retail_price, cogs: p.cogs })))}>⬇ Esporta</button><PersonaPicker chi={chi} setChi={setChi} /></div></header>
      <div className="subtabs">
        {SUBS.map(([k, l]) => <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{l}</button>)}
      </div>
      {sub === 'prod' && <ProdVerify pin={pin} chi={chi} />}
      {sub === 'pubblica' && <Publish />}
      {sub === 'vendite' && <SaleCorrect pin={pin} chi={chi} />}
      {sub === 'diag' && <HealthCheck />}
    </div>
  );
}
