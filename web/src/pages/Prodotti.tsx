import { useEffect, useState } from 'react';
import { pushBack, popBack } from '../lib/backnav';
import { supabase } from '../lib/supabase';
import { fetchProductsTodo, verifyProduct, clearProductCache, fetchLastOrderCost, fetchLastPurchase, fetchSiblingDescription } from '../lib/api';
import type { ProdTodo } from '../lib/api';
import { suggestPrice, marginOf, genSeoTitle } from '../lib/helpers';
import { toast } from '../lib/toast';

// "Pulizia dati" (product completion) + "Pubblica su Shopify" — surfaced as buttons in Registra.
const CATS = ['BAG', 'PELLE', 'TESSUTO', 'ACCESSORI', 'ALTRO'];

/* ---------- Da completare (Benny) ---------- */
function ProdEdit({ p, pin, chi, onDone, remaining }: { p: ProdTodo; pin: string; chi: string; onDone: () => void; remaining?: number }) {
  const [item, setItem] = useState(p.item ?? '');
  const [variant, setVariant] = useState(p.variant ?? '');
  const [cat, setCat] = useState(p.categoria ?? 'BAG');
  const [price, setPrice] = useState(p.retail_price != null ? String(p.retail_price) : '');
  const [cogs, setCogs] = useState(p.cogs != null ? String(p.cogs) : '');
  const [cogsAuto, setCogsAuto] = useState(false);
  const [img, setImg] = useState(p.image_url ?? '');
  const [descr, setDescr] = useState(p.description ?? '');
  const [descrAuto, setDescrAuto] = useState(false);
  const [seo, setSeo] = useState(p.seo_title ?? '');
  const [busy, setBusy] = useState(false);
  const descrRequired = p.bucket === 'nuovo' && p.is_new_model;
  const cogsNum = cogs === '' ? null : Number(cogs);

  // prefill (item 26): COGS pescato dall'ordine/acquisto di Ginni; descrizione dalla variante
  // sorella dello stesso modello. Entrambi restano modificabili prima del salvataggio.
  useEffect(() => {
    let alive = true;
    if (p.cogs == null) {
      (async () => {
        const fromOrder = await fetchLastOrderCost(p.codice).catch(() => null);
        const c = fromOrder ?? (await fetchLastPurchase(p.codice).catch(() => null))?.costo_unitario ?? null;
        if (alive && c != null) { setCogs((cur) => cur === '' ? String(c) : cur); setCogsAuto(true); }
      })();
    }
    if (!p.description && p.item && !p.is_new_model) {
      fetchSiblingDescription(p.item, p.codice).then((d) => {
        if (alive && d) { setDescr((cur) => cur === '' ? d : cur); setDescrAuto(true); }
      }).catch(() => {});
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.codice]);

  async function save() {
    if (!item.trim() || !variant.trim()) return toast('Modello e variante sono obbligatori', 'err');
    if (descrRequired && !descr.trim()) return toast('È un modello nuovo: la descrizione è obbligatoria', 'err');
    if (cogs !== '' && !(Number(cogs) >= 0)) return toast('COGS non valido', 'err');
    setBusy(true);
    // nomi in MAIUSCOLO (decisione call 06-07, item 27) — il server fa lo stesso per difesa
    const itemUp = item.trim().toUpperCase();
    const variantUp = variant.trim().toUpperCase();
    try {
      const res = await verifyProduct({ codice: p.codice, item: itemUp, variant: variantUp, categoria: cat, retail_price: price === '' ? null : Number(price), cogs: cogs === '' ? null : Number(cogs), image_url: img, description: descr, seo_title: seo }, pin, chi) as unknown as { codice?: string; renamed?: boolean; warning?: string };
      // feedback esplicito (item 24): in call Benny non capiva dove fosse finito il prodotto salvato
      toast(`✓ Salvato — ${itemUp} ${variantUp} è completo: ora lo trovi in Magazzino.${res.renamed ? ` Codice definitivo: ${res.codice}.` : ''}${remaining != null && remaining > 0 ? ` Ne restano ${remaining} da sistemare.` : remaining === 0 ? ' Erano gli ultimi: tutto pulito! 🎉' : ''}`, 'ok');
      if (res.warning) toast(res.warning, 'err');
      clearProductCache(); onDone();
    } catch (e) { toast((e as Error).message, 'err'); setBusy(false); }
  }
  return (
    <div className="form">
      <button className="back" onClick={onDone}>← {p.codice}</button>
      <div className="grid2">
        <div><label className="fl">Modello *</label><input className="txt" style={{ textTransform: 'uppercase' }} value={item} onChange={(e) => setItem(e.target.value)} /></div>
        <div><label className="fl">Variante *</label><input className="txt" style={{ textTransform: 'uppercase' }} value={variant} onChange={(e) => setVariant(e.target.value)} /></div>
      </div>
      <p className="note" style={{ margin: '4px 0 0' }}>I nomi si salvano sempre in MAIUSCOLO (regola condivisa).</p>
      <label className="fl">Categoria</label>
      <div className="supgrid">{CATS.map((c) => <button key={c} type="button" className={`supcard ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}</div>
      <div className="grid2">
        <div><label className="fl">Prezzo € (IVA incl.)</label><input className="num" type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div><label className="fl">COGS € (costo unitario){cogsAuto ? ' · dall’ordine di Ginni' : ''}</label><input className="num" type="number" inputMode="decimal" value={cogs} onChange={(e) => { setCogs(e.target.value); setCogsAuto(false); }} placeholder="—" /></div>
      </div>
      {cogsNum && cogsNum > 0 ? (() => { const sug = suggestPrice(cogsNum); return (
        <button type="button" className="hintchip" onClick={() => setPrice(String(sug))}>
          💡 Prezzo consigliato €{sug.toFixed(2)} · margine {Math.round(marginOf(sug, cogsNum) * 100)}% (COGS €{cogsNum})
        </button>); })() : null}
      <label className="fl">Immagine (URL)</label>
      <input className="txt" value={img} onChange={(e) => setImg(e.target.value)} placeholder="https://…" />
      <label className="fl">Descrizione{descrRequired ? ' * (modello nuovo)' : ''}{descrAuto ? ' · proposta dal modello' : ''}</label>
      <input className="txt" value={descr} onChange={(e) => { setDescr(e.target.value); setDescrAuto(false); }} placeholder={descrRequired ? 'Obbligatoria per un modello nuovo' : '—'} />
      <div className="lblrow"><label className="fl">SEO title</label>
        <button type="button" className="minibtn" onClick={() => setSeo(genSeoTitle(item, variant))} disabled={!item || !variant}>genera</button></div>
      <input className="txt" value={seo} onChange={(e) => setSeo(e.target.value)} placeholder="Borsa … AMIMI … Made in Italy" />
      {seo && <div className="charcount">{seo.length} caratteri{seo.length >= 60 && seo.length <= 70 ? ' ✓' : ' (target 60–70)'}</div>}
      <button className="submit" disabled={busy} onClick={save}>{busy ? 'Salvo…' : '✓ Verifica e salva'}</button>
      <p className="note">Le modifiche valgono per l'app: prezzo e COGS contano per vendite e margini FUTURI (lo storico non si ricalcola) e <b>non cambiano nulla su Shopify</b>.</p>
    </div>
  );
}

const TODO_GROUPS: { key: 'nuovo' | 'costo_ricavo'; title: string; sub: string }[] = [
  { key: 'nuovo', title: 'Nuovi da arricchire', sub: 'Appena ordinati. Completa variante, prezzo e immagine — se è un modello nuovo serve anche la descrizione.' },
  { key: 'costo_ricavo', title: 'Impatto su ricavi e costi', sub: 'Manca prezzo o COGS: blocca margine e P&L. Da sistemare.' },
];

export function ProdVerify({ pin, chi }: { pin: string; chi: string }) {
  const [list, setList] = useState<ProdTodo[]>([]);
  const [edit, setEdit] = useState<ProdTodo | null>(null);
  const [showClean, setShowClean] = useState(false);
  const load = () => fetchProductsTodo().then(setList).catch(() => {});
  useEffect(() => { load(); }, []);
  if (edit) return <ProdEdit p={edit} pin={pin} chi={chi} onDone={() => { popBack(() => setEdit(null)); load(); }}
    remaining={list.filter((x) => x.bucket !== 'pulizia' && x.codice !== edit.codice).length} />;
  if (!list.length) return <div className="card muted center">Tutti i prodotti sono verificati. 🎉</div>;

  // DESCR e' richiesta solo per i modelli NUOVI: per le varianti di item esistenti
  // la descrizione vive a livello di modello (gia' scritta), il tag sarebbe rumore.
  const miss = (p: ProdTodo) => [
    !p.item && 'MODELLO', !p.variant && 'VARIANTE', !p.image_url && 'IMG',
    (!p.retail_price && 'PREZZO'), (!p.description && p.is_new_model && 'DESCR'),
  ].filter(Boolean) as string[];

  const card = (p: ProdTodo, dim = false) => (
    <button key={p.codice} className={`todocard${dim ? ' dim' : ''}`} onClick={() => { pushBack(() => setEdit(null)); setEdit(p); }}>
      <div className="invimg sm">{p.image_url ? <img src={p.image_url} alt="" /> : <span>{(p.item ?? p.codice).slice(0, 2)}</span>}</div>
      <div className="todoinfo">
        <div className="rt">{[p.item, p.variant].filter(Boolean).join(' ') || p.codice}
          {p.bucket === 'nuovo' && p.is_new_model && <span className="newmod">nuovo modello</span>}
          {p.venduto > 0 && <span className="hot">venduto {p.venduto}×</span>}
        </div>
        <div className="missrow">{miss(p).map((m) => <span key={m} className="misschip">{m}</span>)}</div>
      </div>
      <span className="chev">›</span>
    </button>
  );

  const groups = TODO_GROUPS.map((g) => ({ ...g, items: list.filter((p) => p.bucket === g.key) }));
  const clean = list.filter((p) => p.bucket === 'pulizia');
  const actionable = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="list">
      {actionable === 0 && (
        <p className="note">Nessun prodotto nuovo o con buchi su prezzo/COGS. Sotto resta solo la pulizia anagrafica, facoltativa.</p>
      )}
      {groups.map((g) => g.items.length ? (
        <section key={g.key} className="todogroup">
          <div className="todoghead"><span className="todogt">{g.title}</span><span className="todogn">{g.items.length}</span></div>
          <p className="todogsub">{g.sub}</p>
          {g.items.map((p) => card(p))}
        </section>
      ) : null)}
      {clean.length ? (
        <section className="todogroup">
          <button type="button" className="todoghead clk" onClick={() => setShowClean((v) => !v)}>
            <span className="todogt dim">Pulizia anagrafica (facoltativa)</span>
            <span className="todogn">{clean.length} {showClean ? '▲' : '▼'}</span>
          </button>
          {showClean && (
            <>
              <p className="todogsub">Prezzo e COGS già presenti. Manca solo immagine, descrizione o modello/variante. Completa quando hai tempo.</p>
              {clean.map((p) => card(p, true))}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

/* ---------- Pubblica su Shopify (gated) ---------- */
type ReadyP = { codice: string; item: string | null; variant: string | null };
export function Publish() {
  const [ready, setReady] = useState<ReadyP[] | null>(null);
  const [filt, setFilt] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const [inv, ord, pr] = await Promise.all([
        supabase.from('v_inventory').select('codice,on_shopify'),
        supabase.from('supplier_orders').select('codice'),
        supabase.from('products').select('codice,item,variant,verificato').eq('verificato', true),
      ]);
      const onShop = new Set((inv.data ?? []).filter((r: { on_shopify: boolean }) => r.on_shopify).map((r: { codice: string }) => r.codice));
      const ordered = new Set((ord.data ?? []).map((r: { codice: string }) => r.codice));
      // only products that have actually been on a supplier order (the rest is old seed junk)
      setReady((pr.data ?? []).filter((p: { codice: string }) => !onShop.has(p.codice) && ordered.has(p.codice)) as ReadyP[]);
    })();
  }, []);

  // KPI chips per modello (clickable filter)
  const byModel = (() => {
    const m = new Map<string, number>();
    (ready ?? []).forEach((p) => { const k = p.item ?? p.codice; m.set(k, (m.get(k) ?? 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const shown = filt ? (ready ?? []).filter((p) => (p.item ?? p.codice) === filt) : (ready ?? []);

  return (
    <div>
      <div className="card warn">
        <b>Pubblicazione live disattivata.</b> Quando un prodotto è verificato e pronto, si pubblica su Shopify + Qromo da qui.
        La pubblicazione automatica su Shopify è disattivata per sicurezza e va riattivata da chi gestisce il sistema.
      </div>
      {ready == null ? <p className="muted center">…</p> : !ready.length ? (
        <div className="card muted center">Niente da pubblicare. Tutti i prodotti ordinati sono già online. 🎉</div>
      ) : (
        <div className="list">
          <p className="note">{ready.length} prodotti (da ordine fornitore) non ancora su Shopify.</p>
          <div className="kpirow">
            <button className={`kpichip ${filt == null ? 'on' : ''}`} onClick={() => setFilt(null)}>Tutti <b>{ready.length}</b></button>
            {byModel.map(([k, n]) => (
              <button key={k} className={`kpichip ${filt === k ? 'on' : ''}`} onClick={() => setFilt(filt === k ? null : k)}>{k} <b>{n}</b></button>
            ))}
          </div>
          {shown.map((p) => (
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

/* ---------- Catalogo: cerca e modifica QUALSIASI prodotto (prezzo, COGS, scheda) ---------- */
type CatRow = {
  codice: string; item: string | null; variant: string | null; model: string | null; categoria: string | null;
  image_url: string | null; retail_price: number | null; cogs: number | null; description: string | null;
  seo_title: string | null; verificato: boolean;
};
const toTodo = (r: CatRow): ProdTodo => ({
  ...r, missing_count: 0, giacenza: 0, venduto: 0, on_shopify: false, source: null,
  is_new_model: false, bucket: 'pulizia', bucket_rank: 3,
});

export function Catalog({ pin, chi }: { pin: string; chi: string }) {
  const [rows, setRows] = useState<CatRow[] | null>(null);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<CatRow | null>(null);
  const load = () => {
    supabase.from('products')
      .select('codice,item,variant,model,categoria,image_url,retail_price,cogs,description,seo_title,verificato')
      .order('item', { nullsFirst: false })
      .then(({ data }) => setRows((data ?? []) as CatRow[]));
  };
  useEffect(() => { load(); }, []);

  if (edit) return <ProdEdit p={toTodo(edit)} pin={pin} chi={chi} onDone={() => { popBack(() => setEdit(null)); clearProductCache(); setEdit(null); load(); }} />;

  const nq = q.trim().toLowerCase();
  const match = (r: CatRow) => !nq
    || r.codice.toLowerCase().includes(nq)
    || (r.item ?? '').toLowerCase().includes(nq)
    || (r.variant ?? '').toLowerCase().includes(nq);
  const found = (rows ?? []).filter(match);
  const shown = found.slice(0, 60);

  return (
    <div className="list">
      <input className="txt" autoFocus placeholder="Cerca per nome, variante o CODICE…" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows == null ? <p className="muted center">…</p> : (
        <>
          <p className="note">{found.length} prodotti{found.length > shown.length ? ` (mostro i primi ${shown.length}: affina la ricerca)` : ''} · tocca per modificare prezzo, COGS e scheda.</p>
          {shown.map((r) => (
            <button key={r.codice} className="todocard" onClick={() => { pushBack(() => setEdit(null)); setEdit(r); }}>
              <div className="invimg sm">{r.image_url ? <img src={r.image_url} alt="" /> : <span>{(r.item ?? r.codice).slice(0, 2)}</span>}</div>
              <div className="todoinfo">
                <div className="rt">{[r.item, r.variant].filter(Boolean).join(' ') || r.codice}</div>
                <div className="missrow">
                  <span className="misschip">{r.retail_price != null ? `€${r.retail_price}` : 'PREZZO —'}</span>
                  <span className="misschip">{r.cogs != null ? `COGS €${r.cogs}` : 'COGS —'}</span>
                </div>
              </div>
              <span className="chev">›</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

