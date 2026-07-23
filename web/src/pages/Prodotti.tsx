import { useEffect, useMemo, useState } from 'react';
import { pushBack, popBack } from '../lib/backnav';
import { supabase } from '../lib/supabase';
import { fetchProductsTodo, verifyProduct, clearProductCache, fetchLastOrderCost, fetchLastPurchase, fetchSiblingDescription, fetchToPublish } from '../lib/api';
import type { ProdTodo } from '../lib/api';
import { suggestPrice, marginOf, genSeoTitle, prettyName } from '../lib/helpers';
import { toast } from '../lib/toast';
import Icon from '../components/Icon';

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

/* ---------- Da completare (Benny) ---------- */
// v21 (brief 23-07 C.1): la CATEGORIA non e' piu' un input manuale — la deriva la tabella
// `models` dal modello (lo stub non scrive piu' 'BAG' fisso e l'upload legge da models).
function ProdEdit({ p, pin, chi, onDone, remaining }: { p: ProdTodo; pin: string; chi: string; onDone: () => void; remaining?: number }) {
  const [item, setItem] = useState(p.item ?? '');
  const [variant, setVariant] = useState(p.variant ?? '');
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
  // Bloccanti di VERIFICA (brief 23-07 B.1/B.4): modello, variante, prezzo>0, COGS>0. Contano solo
  // per la transizione a verificato: su un prodotto gia' verificato il salvataggio e' un normale
  // edit di campo (es. correzione COGS dal catalogo) e passa sempre. IMG resta gate di
  // PUBBLICAZIONE (v_products_to_publish), non di verifica.
  const isVerifica = !p.verificato;
  const bloccanti = [
    !item.trim() && 'Modello', !variant.trim() && 'Variante',
    !(price !== '' && Number(price) > 0) && 'Prezzo', !(cogs !== '' && Number(cogs) > 0) && 'COGS',
  ].filter(Boolean) as string[];
  const completo = bloccanti.length === 0;

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
      // confirm: la VERIFICA vera (transizione a verificato) viaggia solo quando i bloccanti ci
      // sono tutti; un salvataggio parziale resta un edit (il server non marca verificato).
      const res = await verifyProduct({ codice: p.codice, item: itemUp, variant: variantUp, retail_price: price === '' ? null : Number(price), cogs: cogs === '' ? null : Number(cogs), image_url: img, description: descr, seo_title: seo, ...(isVerifica && completo ? { confirm: true } : {}) }, pin, chi) as unknown as { codice?: string; renamed?: boolean; verificato?: boolean; warning?: string };
      // feedback esplicito (item 24): in call Benny non capiva dove fosse finito il prodotto salvato
      if (res.verificato) {
        toast(`✓ Salvato — ${itemUp} ${variantUp} è completo: ora lo trovi in Magazzino.${res.renamed ? ` Codice definitivo: ${res.codice}.` : ''}${remaining != null && remaining > 0 ? ` Ne restano ${remaining} da sistemare.` : remaining === 0 ? ' Erano gli ultimi: tutto pulito! 🎉' : ''}`, 'ok');
      } else {
        toast(`Salvato. ${itemUp} ${variantUp} non è ancora completo: resta in lista.`, 'ok');
      }
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
      <p className="note" style={{ margin: '4px 0 0' }}>I nomi si salvano sempre in MAIUSCOLO (regola condivisa). La categoria la deriva il sistema dal modello.</p>
      <div className="grid2">
        <div><label className="fl">Prezzo € (IVA incl.)</label><input className="num" type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div><label className="fl">COGS € (costo unitario){cogsAuto ? ' · dall’ordine di Ginni' : ''}</label><input className="num" type="number" inputMode="decimal" value={cogs} onChange={(e) => { setCogs(e.target.value); setCogsAuto(false); }} placeholder="—" /></div>
      </div>
      {cogsNum && cogsNum > 0 ? (() => { const sug = suggestPrice(cogsNum); return (
        <button type="button" className="ds-reco" onClick={() => setPrice(String(sug))}>
          <span className="ic"><Icon name="sparkles" size={16} /></span>
          <span className="ht">Prezzo consigliato <b>€{sug.toFixed(2)}</b> · margine <b>{Math.round(marginOf(sug, cogsNum) * 100)}%</b> (COGS €{cogsNum}). Tocca per usarlo.</span>
        </button>); })() : null}
      <label className="fl">Immagine (URL)</label>
      <input className="txt" value={img} onChange={(e) => setImg(e.target.value)} placeholder="https://…" />
      <label className="fl">Descrizione{descrRequired ? ' * (modello nuovo)' : ''}{descrAuto ? ' · proposta dal modello' : ''}</label>
      <input className="txt" value={descr} onChange={(e) => { setDescr(e.target.value); setDescrAuto(false); }} placeholder={descrRequired ? 'Obbligatoria per un modello nuovo' : '—'} />
      <div className="lblrow"><label className="fl">SEO title</label>
        <button type="button" className="minibtn" onClick={() => setSeo(genSeoTitle(item, variant))} disabled={!item || !variant}>genera</button></div>
      <input className="txt" value={seo} onChange={(e) => setSeo(e.target.value)} placeholder="Borsa … AMIMI … Made in Italy" />
      {seo && <div className="charcount">{seo.length} caratteri{seo.length >= 60 && seo.length <= 70 ? ' ✓' : ' (target 60–70)'}</div>}
      {isVerifica && !completo && (
        <p className="note" style={{ marginTop: 12 }}>Per verificare mancano: <b>{bloccanti.join(', ')}</b>. Puoi comunque salvare quello che hai: resta in lista.</p>
      )}
      <button className="ds-btn primary full" style={{ marginTop: isVerifica && !completo ? 6 : 18 }} disabled={busy} onClick={save}>
        {busy ? 'Salvo…' : isVerifica ? (completo ? 'Verifica e salva' : 'Salva (incompleto)') : 'Salva modifiche'}
      </button>
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
// v21 (brief 23-07 D.1): UNICA fonte = v_products_to_publish. La vecchia logica locale
// (verificato + ordini + on_shopify=false) non vedeva le BOZZE Shopify (on_shopify conta solo
// le active) e avrebbe riproposto prodotti gia' caricati in bozza -> doppioni.
type ReadyP = { codice: string; item: string | null; variant: string | null; pronto_stock?: boolean };
export function Publish() {
  const [ready, setReady] = useState<ReadyP[] | null>(null);
  const [filt, setFilt] = useState<string | null>(null);
  useEffect(() => {
    fetchToPublish().then((rows) => setReady(rows as ReadyP[])).catch(() => setReady([]));
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
        <div className="card muted center">Niente da pubblicare. Tutti i prodotti completi sono già su Shopify (bozze incluse). 🎉</div>
      ) : (
        <div className="list">
          <p className="note">{ready.length} prodotti completi (scheda + foto) non ancora su Shopify, nemmeno in bozza.</p>
          <div className="kpirow">
            <button className={`kpichip ${filt == null ? 'on' : ''}`} onClick={() => setFilt(null)}>Tutti <b>{ready.length}</b></button>
            {byModel.map(([k, n]) => (
              <button key={k} className={`kpichip ${filt === k ? 'on' : ''}`} onClick={() => setFilt(filt === k ? null : k)}>{k} <b>{n}</b></button>
            ))}
          </div>
          {shown.map((p) => (
            <div className="row" key={p.codice}>
              <div><div className="rt">{p.item ?? p.codice}{p.pronto_stock === false && <span className="newtag" title="Ordine non ancora arrivato: si può preparare la bozza, il go-live aspetta lo stock">in arrivo</span>}</div><div className="rs">{p.variant ?? ''}</div></div>
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
  const [line, setLine] = useState('');
  const [todoOnly, setTodoOnly] = useState(false);
  const [edit, setEdit] = useState<CatRow | null>(null);
  const load = () => {
    supabase.from('products')
      .select('codice,item,variant,model,categoria,image_url,retail_price,cogs,description,seo_title,verificato')
      .order('item', { nullsFirst: false })
      .then(({ data }) => setRows((data ?? []) as CatRow[]));
  };
  useEffect(() => { load(); }, []);

  const lineOf = (r: CatRow) => (r.item ?? r.codice).trim().split(/[\s_]/)[0];
  const lines = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(lineOf(r), (m.get(lineOf(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
  }, [rows]);

  if (edit) return <ProdEdit p={toTodo(edit)} pin={pin} chi={chi} onDone={() => { popBack(() => setEdit(null)); clearProductCache(); setEdit(null); load(); }} />;

  const nq = q.trim().toLowerCase();
  const isTodo = (r: CatRow) => r.retail_price == null || r.cogs == null;
  const match = (r: CatRow) =>
    (!nq || r.codice.toLowerCase().includes(nq) || (r.item ?? '').toLowerCase().includes(nq) || (r.variant ?? '').toLowerCase().includes(nq))
    && (!line || lineOf(r) === line) && (!todoOnly || isTodo(r));
  const found = (rows ?? []).filter(match);
  const shown = found.slice(0, 80);
  const todoCount = (rows ?? []).filter(isTodo).length;

  return (
    <div>
      <div className="ds-search">
        <Icon name="search" size={18} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca per nome, variante o CODICE…" aria-label="Cerca prodotto" />
      </div>
      {rows == null ? <p className="muted center">…</p> : (
        <>
          <div className="ds-count">{found.length} prodotti{found.length > shown.length ? ` · mostro i primi ${shown.length}` : ''} · tocca per modificare prezzo, COGS e scheda.</div>
          <div className="ds-linefilters">
            <button type="button" className={`ds-fp ${line === '' ? 'on' : ''}`} onClick={() => setLine('')}>Tutte</button>
            {lines.map((l) => <button key={l} type="button" className={`ds-fp ${line === l ? 'on' : ''}`} onClick={() => setLine(line === l ? '' : l)}>{titleCase(l)}</button>)}
            <span className="ds-fp-div" />
            <button type="button" className={`ds-fp ds-fp-todo ${todoOnly ? 'on' : ''}`} onClick={() => setTodoOnly((v) => !v)}>Da completare · {todoCount}</button>
          </div>
          {shown.map((r) => {
            const missing = isTodo(r);
            const marg = r.retail_price != null && r.cogs != null && r.retail_price > 0 ? (r.retail_price - r.cogs) / r.retail_price : null;
            return (
              <button key={r.codice} className={`ds-prow ${missing ? 'miss' : ''}`} onClick={() => { pushBack(() => setEdit(null)); setEdit(r); }}>
                <span className="ds-thumb">{r.image_url ? <img src={r.image_url} alt="" loading="lazy" /> : (r.item ?? r.codice).slice(0, 2).toUpperCase()}</span>
                <div className="ds-pinfo">
                  <div className="ds-pn">{prettyName(r.item, r.variant, r.codice)}</div>
                  <div className="ds-pcode">{r.codice}</div>
                  <div className="ds-dchips">
                    {r.retail_price != null ? <span className="ds-dchip price">€{r.retail_price}</span> : <span className="ds-dchip miss">Prezzo manca</span>}
                    {r.cogs != null ? <span className="ds-dchip cogs">COGS €{r.cogs}</span> : <span className="ds-dchip miss">COGS manca</span>}
                    {marg != null && <span className={`ds-dchip ${marg >= 0.65 ? 'marg' : 'marglow'}`}>margine {Math.round(marg * 100)}%</span>}
                  </div>
                </div>
                <span className="chev">›</span>
              </button>
            );
          })}
          {!found.length && <p className="muted center">Nessun prodotto.</p>}
        </>
      )}
    </div>
  );
}

