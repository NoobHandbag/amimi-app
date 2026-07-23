import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import ExpenseForm from './ExpenseForm';
import Icon from './Icon';
import { fetchExpensesReview, approveExpense } from '../lib/api';
import type { ExpReview } from '../lib/api';
import { toast } from '../lib/toast';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n || 0);
const CATS = ['COGS', 'LOGISTICA', 'MARKETING', 'OPEX', 'PACKAGING', 'SALARI', 'TASSE', 'EVENTI'];
const MESI = ['', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

/** Trasforma la nota alla conferma SENZA perdere lo storico:
 *  "DA VERIFICARE (carburante ENI)" -> "VERIFICATO (carburante ENI)". */
const confirmNote = (note: string | null) => (note ? note.replace(/da verificare/i, 'VERIFICATO') : 'VERIFICATO');

/** Euristica: estrai un nome fornitore leggibile dalla stringa bancaria / glossa.
 *  Preferisce la glossa umana tra parentesi nella nota; poi ripulisce i prefissi bancari. */
function extractVendor(op: string | null, note: string | null): string {
  const tc = (s: string) => s.split(' ').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
  const paren = (note ?? '').match(/\(([^)]+)\)/);
  let s = paren ? paren[1] : (op ?? '');
  s = s.replace(/da verificare/ig, ' ')
    .replace(/\b(pagamento|pos|bonifico|addebito|sdd|carta|disposizione|commission[ei]|ordine|estero|sepa|acquisto|pag|presso|del|il|data|ore|nr?|card|visa|mastercard|operazione|bancomat|prelievo|contactless|fattura)\b/ig, ' ')
    .replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/[€$*]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const words = s.split(' ').filter((w) => w.length >= 2).slice(0, 3);
  const v = words.join(' ');
  return v ? tc(v) : ((op ?? '').slice(0, 40) || 'Spesa');
}

/** Maschera spese: aggiunta diretta + CODA DI REVISIONE (proposte pending + storiche
 *  "DA VERIFICARE" dal task estratto conto). Fornitore estratto in evidenza, raw sotto
 *  "Mostra dettaglio"; conferma a un tocco o ricodifica (categoria/sottocat/Amimì). */
export default function SpeseManage({ pin, chi }: { pin: string; chi: string }) {
  const [list, setList] = useState<ExpReview[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState<Set<string>>(new Set());
  const [recoding, setRecoding] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, { categoria: string; sottocategoria: string; amimi: boolean }>>({});
  const load = () => fetchExpensesReview().then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const toggleSet = (setter: Dispatch<SetStateAction<Set<string>>>, id: string) =>
    setter((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const edited = (e: ExpReview) => edits[e.id] ?? {
    categoria: e.categoria || 'OPEX',
    sottocategoria: e.sottocategoria || '',
    amimi: !!e.amimi,
  };
  const setEdit = (id: string, patch: Partial<{ categoria: string; sottocategoria: string; amimi: boolean }>) =>
    setEdits((m) => {
      const row = list.find((x) => x.id === id);
      const base = m[id] ?? (row ? { categoria: row.categoria || 'OPEX', sottocategoria: row.sottocategoria || '', amimi: !!row.amimi } : { categoria: 'OPEX', sottocategoria: '', amimi: false });
      return { ...m, [id]: { ...base, ...patch } };
    });

  async function confirm(e: ExpReview) {
    const v = edited(e);
    const ricodificata = v.categoria !== (e.categoria || 'OPEX');
    const cambiataSottocat = (v.sottocategoria || '') !== (e.sottocategoria || '');
    const cambiataAmimi = v.amimi !== !!e.amimi;
    let note = confirmNote(e.note);
    if (ricodificata) note += ` · ricodificata ${e.categoria || '?'}→${v.categoria} da ${chi}`;
    // manda SOLO i campi cambiati: la conferma "com'e'" cambia la sola nota e passa anche sui
    // mesi chiusi (il CE non si muove). Prima mandava sempre tutto e il server bloccava con un
    // 409 che veniva ingoiato: era il bug "le spese non si confermano" (feedback 06-07, item 1).
    const payload: Record<string, unknown> = { note };
    if (ricodificata) payload.categoria = v.categoria;
    if (cambiataSottocat) payload.sottocategoria = v.sottocategoria || null;
    if (cambiataAmimi) payload.amimi = v.amimi ? 'si' : 'No';
    setBusy(e.id);
    try {
      try {
        await approveExpense(e.id, 'approved', payload, pin, chi);
      } catch (err) {
        const ce = err as Error & { closedMonth?: boolean };
        if (ce.closedMonth && window.confirm(`${ce.message}\n\nConfermi comunque? Il CE di quel mese cambierà e andrà richiuso.`)) {
          await approveExpense(e.id, 'approved', payload, pin, chi, true);
        } else throw err;
      }
      toast('Spesa verificata ✓', 'ok');
      setEdits((m) => { const n = { ...m }; delete n[e.id]; return n; });
      setRecoding((s) => { const n = new Set(s); n.delete(e.id); return n; });
      load();
    } catch (err) {
      toast((err as Error).message, 'err');
    } finally { setBusy(null); }
  }

  async function reject(e: ExpReview) {
    setBusy(e.id);
    try { await approveExpense(e.id, 'rejected', { note: (e.note ? e.note + ' · ' : '') + `rifiutata da ${chi}` }, pin, chi); toast('Spesa rifiutata', 'ok'); load(); }
    catch (err) { toast((err as Error).message, 'err'); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <button className="ds-btn secondary full" style={{ marginBottom: 14 }} onClick={() => setAdding((a) => !a)}>
        {adding ? 'Chiudi' : <><Icon name="plus" size={17} /> Aggiungi spesa</>}
      </button>
      {adding && <ExpenseForm pin={pin} chi={chi} mode="expense_manual" onDone={() => { setAdding(false); load(); }} />}
      {!list.length ? (
        <div className="card muted center">Nessuna spesa da verificare.</div>
      ) : (
        <>
          <div className="ds-seclb">Da verificare <span className="c">{list.length}</span></div>
          {list.map((e) => {
            const v = edited(e);
            const vendor = extractVendor(e.operazione, e.note);
            const showRaw = detailOpen.has(e.id);
            const isRecoding = recoding.has(e.id);
            const changed = v.categoria !== (e.categoria || 'OPEX') || (v.sottocategoria || '') !== (e.sottocategoria || '') || v.amimi !== !!e.amimi;
            return (
              <div className="ds-expcard" key={e.id}>
                <div className="ds-exptop">
                  <div style={{ minWidth: 0 }}>
                    <div className="ds-expvendor">{vendor}</div>
                    <div className="ds-expmeta">{MESI[e.month] || ''} {e.year}{e.date_paid ? ` · ${e.date_paid}` : ''}{e.status === 'pending' ? ' · proposta' : ''}</div>
                  </div>
                  <b className="ds-expamt">{eur(Math.abs(e.costo))}</b>
                </div>
                <button type="button" className="ds-expraw-toggle" onClick={() => toggleSet(setDetailOpen, e.id)}>{showRaw ? 'Nascondi dettaglio' : 'Mostra dettaglio'}</button>
                {showRaw && <div className="ds-expraw">{e.operazione}{e.note ? ` · ${e.note}` : ''}</div>}

                {!isRecoding ? (
                  <div className="ds-expsug">
                    <span className="ds-expcat">{v.categoria}{v.sottocategoria ? ` · ${v.sottocategoria}` : ''}{v.amimi ? ' · Amimì' : ''}</span>
                    <div className="ds-expactions">
                      <button className="ds-btn primary sm" disabled={busy === e.id} onClick={() => confirm(e)}>Conferma</button>
                      <button className="ds-btn secondary sm" onClick={() => toggleSet(setRecoding, e.id)}>Ricodifica</button>
                    </div>
                  </div>
                ) : (
                  <div className="ds-exprecode">
                    <div>
                      <div className="ds-sublabel">Categoria</div>
                      <div className="ds-linefilters" style={{ marginTop: 6 }}>{CATS.map((c) => <button key={c} type="button" className={`ds-fp ${v.categoria === c ? 'on' : ''}`} onClick={() => setEdit(e.id, { categoria: c })}>{c}</button>)}</div>
                    </div>
                    <div>
                      <div className="ds-sublabel">Sottocategoria</div>
                      <input className="ds-expsel" style={{ marginTop: 6 }} value={v.sottocategoria} placeholder="es. Spedizioni, Carburante…" onChange={(ev) => setEdit(e.id, { sottocategoria: ev.target.value })} />
                    </div>
                    {v.categoria === 'LOGISTICA' && <div className="muted" style={{ fontSize: 11 }}>Sottocategoria "Spedizioni" = costo variabile nel CE, altrimenti logistica fissa.</div>}
                    <label className="ds-toggle"><input type="checkbox" checked={v.amimi} onChange={(ev) => setEdit(e.id, { amimi: ev.target.checked })} /><span className="track"><span className="knob" /></span> Spesa Amimì (brand)</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="ds-btn primary sm" style={{ flex: 1 }} disabled={busy === e.id} onClick={() => confirm(e)}>{changed ? 'Salva ricodifica' : 'Conferma'}</button>
                      <button className="ds-btn secondary sm" onClick={() => toggleSet(setRecoding, e.id)}>Annulla</button>
                      {e.status === 'pending' && <button className="ds-btn danger soft sm" disabled={busy === e.id} onClick={() => reject(e)}>Rifiuta</button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
