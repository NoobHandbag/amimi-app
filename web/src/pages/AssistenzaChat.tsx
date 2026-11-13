import { useEffect, useRef, useState } from 'react';
import {
  addNoise, chatAzione, chatCancellaDati, chatConoscenza, chatImposta, chatImpostazioni, chatReinvia, chatRispondi,
  fetchCardDelThread, fetchChatEmail, fetchChatSessione, sessioneDiChat,
} from '../lib/csApi';
import type { AnteprimaCancella, ChatEmail, ChatSessione, CsConversation, CsMessage, ImpostazioniChat } from '../lib/csApi';

// Chat del sito dentro Assistenza (Fase 1 pezzo 6, docs/PROPOSTA_chat_sito.md 7.6 e sez. 10, modello ticket D-8).
// La chat vive in chat_ (fonte di verita'); qui si legge la sua proiezione in cs_ e ogni azione passa da chat-staff:
// la risposta compare nella chat e parte SUBITO per email da info@ (niente presenza, D-8), "Prendo io" e "Chiudi" cambiano
// chat_sessioni (cs-api set_stato rifiuta le chat), "Non e' un cliente" sposta la chat nel Rumore senza bloccare nessuno
// (l'email e' solo dichiarata nel widget), niente bozze AI (7.10). La scheda Chat cambia orari, solleciti e testi.

const NOMI: Record<string, string> = { B: 'Benedetta', G: 'Ginevra', A: 'Ale' };
const fmt = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const STATO_CHAT: Record<string, string> = {
  bot: 'Gestita dalle risposte automatiche', attesa_persona: 'Chiede una persona', aperta: 'Aperta', chiusa: 'Chiusa',
};
const ESITO_EMAIL: Record<string, string> = { inviata: 'Inviata anche via email', in_corso: 'Email in partenza', in_coda: 'Email in coda (riprova da sola entro 5 minuti)' };

function etichettaEmail(e: ChatEmail | undefined): { testo: string; cls: string; reinviabile: boolean } | null {
  if (!e) return null;
  if (e.email_stato === 'inviata') return { testo: `✉️ Inviata anche via email${e.email_at ? ' · ' + fmt(e.email_at) : ''}`, cls: 'ok', reinviabile: false };
  if (e.email_stato === 'prenotata') return { testo: '✉️ Email in partenza…', cls: 'warn', reinviabile: false };
  if (e.email_stato === 'errore') {
    const nonPartita = /^non partita: /.test(e.email_errore ?? '');
    return { testo: `⚠ Email ${nonPartita ? 'non partita' : 'da controllare'}: ${e.email_errore ?? ''}`, cls: 'err', reinviabile: nonPartita };
  }
  return { testo: '✉️ Email in coda (riparte da sola entro 5 minuti)', cls: 'warn', reinviabile: true };
}

type PropsThread = {
  c: CsConversation;
  msgs: CsMessage[] | null;
  ident: string;
  convs: CsConversation[] | null;
  onRicarica: () => Promise<void>;
  onApri: (c: CsConversation) => void;
  onUscita: (msg: string) => void;
  showToast: (msg: string) => void;
};

export function ChatThread({ c, msgs, ident, convs, onRicarica, onApri, onUscita, showToast }: PropsThread) {
  const sid = sessioneDiChat(c);
  const [sess, setSess] = useState<ChatSessione | null>(null);
  const [emails, setEmails] = useState<Record<string, ChatEmail>>({});
  const [card, setCard] = useState<CsConversation | null>(null);
  const [err, setErr] = useState('');
  // l'esito dell'ultima azione, nel pannello: il toast della pagina si vede solo in coda
  const [esito, setEsito] = useState('');
  const [busy, setBusy] = useState(false);
  const [testo, setTesto] = useState('');
  const [conferma, setConferma] = useState<{ sendKey: string } | null>(null);
  const [more, setMore] = useState(false);
  const [cancella, setCancella] = useState<AnteprimaCancella | null>(null);
  const [conCard, setConCard] = useState(false);
  const corrente = useRef('');

  const carica = async () => {
    if (!sid) return;
    corrente.current = sid;
    try {
      const [s, e] = await Promise.all([fetchChatSessione(sid), fetchChatEmail(sid)]);
      if (corrente.current !== sid) return;
      setSess(s); setEmails(e);
      if (s?.gmail_thread_id) {
        const k = await fetchCardDelThread(s.gmail_thread_id).catch(() => null);
        if (corrente.current === sid) setCard(k);
      } else setCard(null);
    } catch (x) { if (corrente.current === sid) setErr((x as Error).message); }
  };
  useEffect(() => {
    setSess(null); setEmails({}); setCard(null); setErr(''); setEsito(''); setTesto(''); setConferma(null); setMore(false); setCancella(null);
    void carica();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  const ricarica = async () => { await onRicarica(); await carica(); };
  const azione = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setErr('');
    try { await fn(); setEsito(ok); showToast(ok); await ricarica(); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };

  if (!sid) return <div className="err">Chiave della chat non leggibile: {c.gmail_thread_id}</div>;
  const chiusa = sess?.stato === 'chiusa';
  const verificata = !!sess?.shopify_customer_id;
  const chi = NOMI[ident] ?? ident;
  const stessaEmail = (convs ?? []).filter((x) => x.id !== c.id && x.id !== card?.id && x.canale !== 'rumore'
    && (x.customer_email || '').trim().toLowerCase() === (c.customer_email || '').trim().toLowerCase() && !!c.customer_email);

  const invia = async () => {
    if (!conferma || !testo.trim()) return;
    setBusy(true); setErr(''); setEsito('');
    try {
      const r = await chatRispondi(sid, testo, ident, conferma.sendKey);
      setConferma(null); setTesto('');
      const esito = r.email === 'errore' ? `⚠ Risposta in chat salvata, ma l'email non è partita: ${r.email_errore ?? ''}` : `✓ Risposta inviata in chat. ${ESITO_EMAIL[r.email] ?? ''}`;
      const detto = r.ripetuta ? 'Era già stata inviata: niente doppioni.' : esito;
      setEsito(detto); showToast(detto);
      await ricarica();
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const apriCancella = async () => {
    setMore(false); setBusy(true); setErr('');
    try { setCancella(await chatCancellaDati(sid, ident, false)); setConCard(false); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const confermaCancella = async () => {
    setBusy(true); setErr('');
    try {
      await chatCancellaDati(sid, ident, true, conCard);
      setCancella(null);
      onUscita('Dati della chat cancellati');
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const rumore = async () => {
    setMore(false);
    if (!window.confirm('Sposto questa chat nel Rumore. Non blocca nessuno: l’email l’ha solo scritta chi ha aperto la chat. Confermi?')) return;
    setBusy(true); setErr('');
    try { await addNoise(c.id, c.customer_email || 'chat', ident); onUscita('Chat spostata nel Rumore'); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <div className="cs-actions-row">
        {sess && (sess.stato === 'attesa_persona' || sess.stato === 'bot') && (
          <button className="cs-btn cs-ghost" disabled={busy} onClick={() => azione(() => chatAzione('prendo_io', sid, ident), `Chat presa da ${chi}`)} type="button">✋ Prendo io</button>
        )}
        {sess && !chiusa && (
          <button className="cs-btn cs-ghost cs-okbtn" disabled={busy} type="button" onClick={() => {
            if (window.confirm('Chiudo la chat? La cliente non potrà più scrivere in questa chat: se riscrive, ne apre una nuova.')) void azione(() => chatAzione('chiudi', sid, ident), 'Chat chiusa');
          }}>✓ Chiudi la chat</button>
        )}
        <div className="cs-more-wrap">
          <button className="cs-btn cs-ghost cs-morebtn" onClick={() => setMore((o) => !o)} type="button" aria-label="Altre azioni della chat" aria-expanded={more}>⋯</button>
          {more && (
            <div className="cs-moremenu">
              <button type="button" disabled={busy} onClick={() => { void rumore(); }}>🚫 Non è un cliente</button>
              <div className="cs-note" style={{ margin: '2px 8px 6px', textAlign: 'left' }}>Sposta la chat nel Rumore. Non blocca nessun mittente.</div>
              <button type="button" disabled={busy} onClick={() => {
                setMore(false);
                if (window.confirm('Revoco i link "Continua la chat"? La cliente non potrà più riaprire la chat dal sito o dalle email; le prossime email partono senza link. Serve per un’email sbagliata o un link inoltrato.')) void azione(() => chatAzione('revoca_accessi', sid, ident), 'Accessi revocati');
              }}>🔒 Revoca accessi</button>
              <button type="button" disabled={busy} onClick={() => { void apriCancella(); }}>🗑 Cancella dati…</button>
              <div className="cs-note" style={{ margin: '2px 8px 6px', textAlign: 'left' }}>Su richiesta della cliente (GDPR): prima un’anteprima, poi la conferma.</div>
            </div>
          )}
        </div>
      </div>

      <div className="cs-banner cs-chatbanner">
        <b>💬 Chat del sito</b>{sess ? ` · ${STATO_CHAT[sess.stato] ?? sess.stato}${sess.preso_da ? ' · ' + sess.preso_da : ''}` : ''}{sess?.prova ? ' · PROVA' : ''}
        <div style={{ marginTop: 4 }}>Ogni risposta compare nella chat e parte <b>subito per email</b> da info@amimi.it a {c.customer_email || 'la cliente'} (con il link “Continua la chat”).</div>
        {sess && !verificata && (
          <div className="cs-lint" style={{ marginTop: 8 }}>⚠️ <b>Email non verificata</b>: l’ha scritta chi ha aperto la chat, senza login. Niente dati d’ordine o personali nella risposta.</div>
        )}
        {card && (
          <div style={{ marginTop: 8 }}>
            <button type="button" className="cs-btn cs-ghost" style={{ fontSize: 12 }} onClick={() => onApri(card)}>✉️ La cliente ha risposto anche per email: apri la card ↗</button>
          </div>
        )}
        {stessaEmail.length > 0 && (
          <div className="cs-note" style={{ textAlign: 'left', marginTop: 8 }}>
            Stessa email dichiarata in {stessaEmail.length === 1 ? 'un’altra conversazione' : `altre ${stessaEmail.length} conversazioni`}: <b>non verificata</b>, potrebbe non essere la stessa persona.
          </div>
        )}
      </div>
      {err && <div className="err">{err}</div>}
      {esito && <div className="cs-note cs-chatesito" role="status" style={{ textAlign: 'left' }}>{esito}</div>}

      {msgs !== null && msgs.length > 0 && <div className="ds-seclb" style={{ marginTop: 12 }}>Conversazione</div>}
      {msgs === null ? <div className="muted center" style={{ padding: 20 }}>Carico messaggi…</div> :
        msgs.length === 0 ? <div className="muted center" style={{ padding: 20 }}>La cliente ha chiesto una persona senza scrivere.</div> :
          msgs.map((m) => {
            const out = m.direction === 'out';
            const idChat = (m.gmail_message_id ?? '').replace(/^chat:/, '');
            const e = out && m.is_via_tool ? etichettaEmail(emails[idChat]) : null;
            return (
              <div key={m.id} className={'cs-msg ' + (out ? 'out' : 'in')}>
                <div className="cs-mh">{out ? `${fmt(m.sent_at)} · ${m.sent_by || 'Amimì'}` : `${c.customer_name || 'Cliente'} · ${fmt(m.sent_at)}`}</div>
                <div className="cs-mb"><div className="cs-body">{m.body_clean ?? m.body_text ?? ''}</div></div>
                {e && (
                  <div className={'cs-mailstate ' + e.cls}>
                    {e.testo}
                    {e.reinviabile && (
                      <button type="button" className="cs-btn cs-ghost" style={{ fontSize: 12, marginLeft: 8 }} disabled={busy}
                        onClick={() => azione(async () => { await chatReinvia(idChat, ident); }, 'Email ritentata')}>↻ Riprova l’email</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

      <div className="cs-draftbox">
        {chiusa ? (
          <div className="cs-note" style={{ textAlign: 'left' }}>Chat chiusa {sess?.chiusa_at ? 'il ' + fmt(sess.chiusa_at) : ''}: non riceve più risposte. Se la cliente riscrive dal sito apre una chat nuova; se risponde all’email, la trovi come card email.</div>
        ) : (
          <>
            <div className="cs-draft-h"><span>✍️ Risposta (firma {chi})</span></div>
            <textarea className="cs-draft-ta" value={testo} onChange={(e) => setTesto(e.target.value)} rows={6} maxLength={4000}
              placeholder="Scrivi la risposta: compare nella chat e parte subito per email" aria-label="Risposta alla chat" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button className="cs-btn cs-primary" type="button" disabled={busy || !testo.trim() || !sess}
                onClick={() => { setErr(''); setConferma({ sendKey: crypto.randomUUID() }); }}>💬 Invia in chat…</button>
            </div>
            <div className="cs-note">Niente bozze AI sulle chat (il testo resta fra noi e il fornitore del bot). Rispondi entro 2 giorni lavorativi: dopo 24 e 48 ore partono i promemoria.</div>
          </>
        )}
        {conferma && (
          <div className="cs-sendwrap" role="dialog" aria-modal="true" aria-label="Conferma risposta in chat">
            <div className="cs-sendmodal">
              <div className="cs-send-h">💬 Conferma risposta</div>
              <div className="cs-send-row"><span className="k">A</span><b>{c.customer_email}</b></div>
              <div className="cs-send-row"><span className="k">Da</span><span>info@amimi.it · firma {chi}</span></div>
              <div className="cs-send-row"><span className="k">Come</span><span>nella chat del sito e subito per email (un thread per chat)</span></div>
              {sess && !verificata && <div className="cs-lint" style={{ marginTop: 10 }}>⚠️ Email non verificata: niente dati d’ordine o personali.</div>}
              <div className="cs-send-preview">{testo}</div>
              {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
              <div className="cs-send-actions">
                <button className="cs-btn cs-ghost" onClick={() => setConferma(null)} disabled={busy} type="button">Annulla</button>
                <button className="cs-btn cs-primary" onClick={() => { void invia(); }} disabled={busy} type="button">{busy ? 'Invio…' : '✓ Invia adesso'}</button>
              </div>
            </div>
          </div>
        )}
        {cancella && (
          <div className="cs-sendwrap" role="dialog" aria-modal="true" aria-label="Cancella i dati della chat">
            <div className="cs-sendmodal">
              <div className="cs-send-h">🗑 Cancella i dati della chat</div>
              {cancella.sessioni.map((x) => (
                <div key={x.id} className="cs-send-row"><span className="k">Chat</span><span>{x.messaggi} messaggi{x.prova ? ' · prova' : ''}{x.card_email ? ' · c’è una card email collegata' : ''}</span></div>
              ))}
              {cancella.sessioni.some((x) => x.card_email) && (
                <label className="cs-note" style={{ display: 'flex', gap: 6, textAlign: 'left', alignItems: 'center' }}>
                  <input type="checkbox" checked={conCard} onChange={(e) => setConCard(e.target.checked)} /> Cancella anche la card email della risposta della cliente
                </label>
              )}
              {cancella.promemoria.map((p, i) => <div key={i} className="cs-note" style={{ textAlign: 'left' }}>{p}</div>)}
              {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
              <div className="cs-send-actions">
                <button className="cs-btn cs-ghost" onClick={() => setCancella(null)} disabled={busy} type="button">Annulla</button>
                <button className="cs-btn cs-primary" onClick={() => { void confermaCancella(); }} disabled={busy} type="button">{busy ? 'Cancello…' : 'Cancella per sempre'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------- scheda Chat (sez. 10) ----------------
type Orari = { tz: string; giorni: number[]; dalle: string; alle: string; chiusure: string[] };
const GIORNI: [number, string][] = [[1, 'Lun'], [2, 'Mar'], [3, 'Mer'], [4, 'Gio'], [5, 'Ven'], [6, 'Sab'], [7, 'Dom']];
const TESTI: [string, string, string][] = [
  ['chat_testo_saluto', 'Saluto', 'Il primo messaggio del pannello.'],
  ['chat_testo_orari', 'Orari', 'Mostrato prima di scrivere.'],
  ['chat_testo_attesa', 'Attesa (in orario)', 'Quando la cliente chiede una persona. {email} = la sua email mascherata.'],
  ['chat_testo_fuori_orario', 'Attesa (fuori orario)', 'Come sopra, fuori dagli orari: senza tempi promessi.'],
];
const leggiJson = <T,>(v: string | undefined, riserva: T): T => { try { return v ? (JSON.parse(v) as T) : riserva; } catch { return riserva; } };

export function ChatScheda({ ident, mostraProve, setMostraProve }: { ident: string; mostraProve: boolean; setMostraProve: (v: boolean) => void }) {
  const [imp, setImp] = useState<ImpostazioniChat | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [orari, setOrari] = useState<Orari | null>(null);
  const [chiusure, setChiusure] = useState('');
  const [ore, setOre] = useState<[string, string]>(['24', '48']);
  const [testi, setTesti] = useState<Record<string, { it: string; en: string }>>({});
  const [faq, setFaq] = useState<Record<number, { testo_it: string; testo_en: string; attiva: boolean }>>({});

  const carica = async () => {
    setErr('');
    try {
      const i = await chatImpostazioni(ident);
      setImp(i);
      const o = leggiJson<Orari | null>(i.valori.chat_orari, null);
      setOrari(o && Array.isArray(o.giorni) ? o : { tz: 'Europe/Rome', giorni: [1, 2, 3, 4, 5], dalle: '09:00', alle: '18:00', chiusure: [] });
      setChiusure((o?.chiusure ?? []).join(', '));
      const p = (i.valori.chat_sollecito_ore ?? '24,48').split(',');
      setOre([p[0] ?? '24', p[1] ?? '48']);
      setTesti(Object.fromEntries(TESTI.map(([k]) => [k, leggiJson(i.valori[k], { it: '', en: '' })])));
      setFaq(Object.fromEntries(i.faq.map((f) => [f.id, { testo_it: f.testo_it ?? '', testo_en: f.testo_en ?? '', attiva: f.attiva }])));
    } catch (x) { setErr((x as Error).message); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carica(); }, []);

  const salva = async (chiave: string, valore: unknown, nome: string) => {
    setBusy(true); setErr(''); setMsg('');
    try { const r = await chatImposta(chiave, valore, ident); setMsg(r.invariato ? `${nome}: niente da cambiare` : `${nome}: salvato ✓`); await carica(); }
    catch (x) { setErr(`${nome}: ${(x as Error).message}`); }
    setBusy(false);
  };
  const salvaFaq = async (id: number) => {
    setBusy(true); setErr(''); setMsg('');
    try { await chatConoscenza(id, faq[id], ident); setMsg('Risposta salvata ✓'); await carica(); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  if (!imp || !orari) return <div className="muted center cs-empty">{err || 'Carico le impostazioni…'}</div>;
  const accesa = (imp.valori.chat_sito_enabled ?? '').trim() === 'true';
  const bottoni = leggiJson<{ id: string; it: string; en: string; faq: number | null }[]>(imp.valori.chat_bottoni, []);

  return (
    <div className="cs-chatset">
      <div className="card">
        <div className="cs-send-h">Stato</div>
        <div className="cs-note" style={{ textAlign: 'left' }}>
          Chat del sito <b>{accesa ? 'accesa' : 'spenta'}</b> (si accende al go-live, non da qui) · {imp.valori.chat_limite_chat_giorno ?? '50'} chat nuove al giorno al massimo · dati cancellati dopo {imp.valori.chat_conservazione_mesi ?? '12'} mesi.
        </div>
        <label className="cs-note" style={{ display: 'flex', gap: 6, alignItems: 'center', textAlign: 'left' }}>
          <input type="checkbox" checked={mostraProve} onChange={(e) => setMostraProve(e.target.checked)} /> Mostra in coda le chat di prova (solo su questo dispositivo)
        </label>
      </div>
      {err && <div className="err">{err}</div>}
      {msg && <div className="cs-note">{msg}</div>}

      <div className="card">
        <div className="cs-send-h">Orari del team</div>
        <div className="cs-note" style={{ textAlign: 'left' }}>Decidono il testo di attesa (in orario o fuori) e i giorni in cui contano i promemoria.</div>
        <div className="cs-chiprow">
          {GIORNI.map(([g, n]) => (
            <label key={g} className="cs-badge" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={orari.giorni.includes(g)} onChange={(e) => setOrari({ ...orari, giorni: e.target.checked ? [...orari.giorni, g].sort() : orari.giorni.filter((x) => x !== g) })} /> {n}
            </label>
          ))}
        </div>
        <div className="cs-case-row">
          <label>dalle <input type="time" value={orari.dalle} onChange={(e) => setOrari({ ...orari, dalle: e.target.value })} aria-label="Dalle" /></label>
          <label>alle <input type="time" value={orari.alle} onChange={(e) => setOrari({ ...orari, alle: e.target.value })} aria-label="Alle" /></label>
        </div>
        <div className="cs-fld"><label>Giorni di chiusura (AAAA-MM-GG, separati da virgola)</label>
          <input value={chiusure} onChange={(e) => setChiusure(e.target.value)} placeholder="2026-12-24, 2026-12-25" /></div>
        <button className="cs-btn cs-primary" type="button" disabled={busy} onClick={() => salva('chat_orari', {
          tz: 'Europe/Rome', giorni: orari.giorni, dalle: orari.dalle, alle: orari.alle, chiusure: chiusure.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean),
        }, 'Orari')}>Salva gli orari</button>
      </div>

      <div className="card">
        <div className="cs-send-h">Promemoria se nessuno risponde</div>
        <div className="cs-note" style={{ textAlign: 'left' }}>Ore lavorative dalla richiesta: il primo a Ginni (tema Assistenza), il secondo ad Ale.</div>
        <div className="cs-case-row">
          <label>primo dopo <input type="number" min={0.05} max={240} step={0.05} value={ore[0]} onChange={(e) => setOre([e.target.value, ore[1]])} aria-label="Primo promemoria, ore" /> ore</label>
          <label>secondo dopo <input type="number" min={0.05} max={240} step={0.05} value={ore[1]} onChange={(e) => setOre([ore[0], e.target.value])} aria-label="Secondo promemoria, ore" /> ore</label>
        </div>
        <button className="cs-btn cs-primary" type="button" disabled={busy} onClick={() => salva('chat_sollecito_ore', [Number(ore[0]), Number(ore[1])], 'Promemoria')}>Salva i promemoria</button>
      </div>

      {TESTI.map(([k, nome, aiuto]) => (
        <div className="card" key={k}>
          <div className="cs-send-h">{nome}</div>
          <div className="cs-note" style={{ textAlign: 'left' }}>{aiuto}</div>
          <div className="cs-fld"><label>Italiano</label>
            <textarea className="cs-draft-ta" rows={3} maxLength={1000} value={testi[k]?.it ?? ''} onChange={(e) => setTesti({ ...testi, [k]: { ...testi[k], it: e.target.value } })} aria-label={nome + ' in italiano'} /></div>
          <div className="cs-fld"><label>Inglese</label>
            <textarea className="cs-draft-ta" rows={3} maxLength={1000} value={testi[k]?.en ?? ''} onChange={(e) => setTesti({ ...testi, [k]: { ...testi[k], en: e.target.value } })} aria-label={nome + ' in inglese'} /></div>
          <button className="cs-btn cs-primary" type="button" disabled={busy} onClick={() => salva(k, testi[k], nome)}>Salva</button>
        </div>
      ))}

      <div className="card">
        <div className="cs-send-h">Bottoni rapidi e risposte</div>
        {bottoni.length === 0 && <div className="cs-note">Nessun bottone.</div>}
        {bottoni.map((b) => (
          <div key={b.id} style={{ marginTop: 8 }}>
            <b>{b.it}</b> <span className="muted">({b.en})</span>
            {b.faq === null || !faq[b.faq] ? (
              <div className="cs-note" style={{ textAlign: 'left' }}>Non collegato a una risposta: il bottone non compare nel widget.</div>
            ) : (
              <>
                <div className="cs-fld"><label>Risposta in italiano</label>
                  <textarea className="cs-draft-ta" rows={4} maxLength={4000} value={faq[b.faq].testo_it} onChange={(e) => setFaq({ ...faq, [b.faq as number]: { ...faq[b.faq as number], testo_it: e.target.value } })} aria-label={'Risposta ' + b.it + ' in italiano'} /></div>
                <div className="cs-fld"><label>Risposta in inglese</label>
                  <textarea className="cs-draft-ta" rows={4} maxLength={4000} value={faq[b.faq].testo_en} onChange={(e) => setFaq({ ...faq, [b.faq as number]: { ...faq[b.faq as number], testo_en: e.target.value } })} aria-label={'Risposta ' + b.it + ' in inglese'} /></div>
                <label className="cs-note" style={{ display: 'flex', gap: 6, alignItems: 'center', textAlign: 'left' }}>
                  <input type="checkbox" checked={faq[b.faq].attiva} onChange={(e) => setFaq({ ...faq, [b.faq as number]: { ...faq[b.faq as number], attiva: e.target.checked } })} /> attiva
                </label>
                <button className="cs-btn cs-primary" type="button" disabled={busy} onClick={() => salvaFaq(b.faq as number)}>Salva la risposta</button>
                <div className="cs-note" style={{ textAlign: 'left' }}>È la stessa risposta standard che usano le bozze delle email.</div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
