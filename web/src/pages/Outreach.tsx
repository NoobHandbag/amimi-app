import { useEffect, useMemo, useState } from 'react';
import { fetchTouches, addTouch, renderTemplate, STAGES, STAGE_LABEL, ESITI, VERDETTO_LABEL, TIPO_LABEL, fetchDrafts, generaBozza, inviaBozza, inviaProva, indirizzoInterno, sbloccaBozza, scartaBozza, segnaposto, LEAD_MITTENTE, cercaInviate, agganciaTocco, inviaRisposta, fetchInbound, inboundCollega, inboundScarta, inboundCrea, nuovoNegozio } from '../lib/leadApi';
import type { LeadOutreach, LeadTouch, LeadSequence, LeadDraft, InviataCandidata, LeadInbound, NegozioCandidato } from '../lib/leadApi';
import { negozioCiHaScritto, dopoInvioManuale, rispostaPreparata, avvisiTesto } from '../lib/leadRegole';

// Sezione Outreach (tappa 1 del PIANO_Outreach_CRM.md): pipeline per stadio, coda del giorno, scheda con
// timeline dei tocchi e compositore da template, sequenze. Nessun invio dall'app: le email si mandano da
// Gmail (bottone "Apri in Gmail") e si registrano con "Segna come inviata". Ogni azione = INSERT in lead_touches.

const fmtD = (iso: string | null | undefined) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); };
const fmtDT = (iso: string) => { const d = new Date(iso); return d.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const CANALI: Record<string, string> = { email: 'Email', telefono: 'Telefono', instagram_dm: 'Instagram DM', visita: 'Visita', altro: 'Altro' };

function Due({ r }: { r: LeadOutreach }) {
  if (r.da_gestire) return <span className="or-due late">risposta da gestire</span>;
  if (r.bozza_auto_tocco != null) return <span className="or-due late">follow-up {r.bozza_auto_tocco} pronto da rivedere</span>;
  if (r.scaduta) return <span className="or-due late">{r.prossima_azione ?? 'azione'} · scaduta {fmtD(r.prossima_azione_at)}</span>;
  if (r.prossima_azione_at) return <span className="or-due">{r.prossima_azione ?? 'prossima azione'} · {fmtD(r.prossima_azione_at)}</span>;
  if (r.lead_stage === 'da_contattare' && !r.n_tocchi) return <span className="or-due">{r.telefono_maps || r.telefono ? 'telefono prima' : r.email_generica || r.email_sito ? 'email 1 da scrivere' : 'nessun contatto: cercarlo'}</span>;
  if (r.giorni_da_ultimo != null) return <span className="or-due muted">{r.giorni_da_ultimo} gg dall&#8217;ultimo tocco</span>;
  return null;
}

function Card({ r, urls, onOpen }: { r: LeadOutreach; urls: Record<string, string>; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="or-card" onClick={() => onOpen(r.id)}>
      {r.thumb && urls[r.thumb] ? <img src={urls[r.thumb]} alt="" /> : <span className="or-thumb-empty" />}
      <div className="or-card-b">
        <div className="or-n">{r.nome}</div>
        <div className="or-m">{[r.citta ?? r.paese, r.tier ? `Tier ${r.tier}` : r.tier_proposto ? `${r.tier_proposto}?` : null, r.totale != null ? r.totale : null].filter((x) => x != null).join(' · ')}</div>
        {r.ultimo_tocco_at && <div className="or-m">{CANALI[r.ultimo_canale ?? ''] ?? r.ultimo_canale} {r.ultima_direzione === 'in' ? 'ricevuta' : 'inviata'} · {fmtD(r.ultimo_tocco_at)}{r.ultimo_chi ? ` · ${r.ultimo_chi}` : ''}</div>}
        <Due r={r} />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
export function OutreachBoard({ rows, urls, onOpen }: { rows: LeadOutreach[]; urls: Record<string, string>; onOpen: (id: string) => void }) {
  const contattati = rows.filter((r) => r.n_email_out > 0 || (r.n_tocchi > 0 && r.lead_stage !== 'da_contattare'));
  const risposti = rows.filter((r) => ['risposto', 'interessato', 'materiale_inviato', 'appuntamento', 'primo_ordine', 'attivo'].includes(r.lead_stage));
  const cols = STAGES.filter((s) => s.key !== 'opt_out' || rows.some((r) => r.lead_stage === 'opt_out'));
  return (
    <>
      <div className="kpis">
        <div className="ds-kpi"><div className="v">{rows.filter((r) => r.lead_stage === 'da_contattare').length}</div><div className="l">Da contattare</div><div className="s">verdetto positivo, nessun tocco ancora</div></div>
        <div className="ds-kpi"><div className="v">{contattati.length}</div><div className="l">Contattati</div><div className="s">{rows.filter((r) => r.n_tocchi > 0 && r.ultimo_tocco_at && Date.now() - new Date(r.ultimo_tocco_at).getTime() < 7 * 864e5).length} toccati negli ultimi 7 giorni</div></div>
        <div className={`ds-kpi ${risposti.length ? 'pos' : ''}`}><div className="v">{contattati.length ? `${Math.round((risposti.length / contattati.length) * 100)}%` : '—'}</div><div className="l">Tasso di risposta</div><div className="s">{risposti.length} su {contattati.length} contattati</div></div>
        <div className={`ds-kpi ${rows.some((r) => r.scaduta || r.da_gestire) ? 'neg' : ''}`}><div className="v">{rows.filter((r) => r.scaduta || r.da_gestire).length}</div><div className="l">Da fare oggi</div><div className="s">{rows.filter((r) => r.scaduta).length} scadute · {rows.filter((r) => r.da_gestire).length} risposte</div></div>
      </div>
      {/* su telefono (sotto i 700 px, index.css) il kanban diventa una lista unica per stadio: gli stadi vuoti spariscono */}
      {!rows.length && <p className="muted or-solo-tel">Nessun negozio in pipeline.</p>}
      <div className="or-board">
        {cols.map((s) => { const list = rows.filter((r) => r.lead_stage === s.key); return (
          <div key={s.key} className={list.length ? 'or-col' : 'or-col empty'}>
            <h3><span>{s.label}</span><span>{list.length}</span></h3>
            {list.map((r) => <Card key={r.id} r={r} urls={urls} onOpen={onOpen} />)}
          </div>
        ); })}
      </div>
      <p className="note">Entrano qui i negozi con verdetto "da contattare". Lo stadio si cambia dalla scheda (registrando un tocco o con "Sposta a"). "Primo ordine" e "Attivo" per ora si spostano a mano: l&#8217;aggancio automatico alle vendite B2B arriva con la tappa 4.</p>
    </>
  );
}


// ---------------------------------------------------------------------------------------------
// v13 (blocco C del cruscotto B2B): ingresso inbound. In cima alla Coda, i messaggi di Assistenza che possono essere un
// negozio e non sono ancora qui (vista v_lead_inbound: modulo del sito classificato B2B, email a wholesale@, mittenti gia'
// noti), con "Collega a", "Crea negozio" e "Non e' un negozio"; e "Nuovo negozio" per un ingresso da Instagram, telefono,
// visita o fiera. Assistenza si legge soltanto. Un negozio nuovo non nasce se ne esiste uno uguale (email, Instagram, sito,
// nome+citta'): la edge risponde con i candidati e la persona sceglie se collegarsi a uno di quelli o crearlo comunque.
type FormNegozio = { convId: string | null; nome: string; citta: string; tipo: string; email: string; telefono: string; ig: string; website: string; canale: string; referente: string; nota: string; duplicati: NegozioCandidato[] };
const CANALI_INGRESSO: Record<string, string> = { instagram_dm: 'Instagram', telefono: 'Telefono', visita: 'Visita in negozio', email: 'Email', altro: 'Fiera, passaparola, altro' };
const viaLabel: Record<string, string> = { email: 'stessa email del negozio', contatto: 'e’ un suo contatto', dominio: 'stesso dominio del sito', sito: 'stesso sito', instagram: 'stesso Instagram', "nome e citta'": 'stesso nome e citta’' };

function InboundCoda({ who, onChanged, onOpen }: { who: string; onChanged: () => Promise<void>; onOpen: (id: string) => void }) {
  const [inbound, setInbound] = useState<LeadInbound[] | null>(null);
  const [msg, setMsg] = useState<{ t: string; err: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormNegozio | null>(null);
  const carica = async () => { try { setInbound(await fetchInbound()); } catch (e) { setInbound([]); setMsg({ t: 'Messaggi da collegare non disponibili: ' + (e as Error).message, err: true }); } };
  useEffect(() => { void carica(); }, []);
  const fatto = async (t: string, apri?: string) => {
    setMsg({ t, err: false });
    try { await onChanged(); } catch { /* il ricarico della pipeline non annulla l'azione fatta */ }
    await carica();
    if (apri) onOpen(apri);
  };
  const collega = async (m: LeadInbound, c: NegozioCandidato) => {
    setBusy(true); setMsg(null);
    try { const r = await inboundCollega({ conv_id: m.conv_id, account_id: c.id, chi: who }); setForm(null); await fatto(`Collegato a ${c.nome}: ${r.tocchi} messaggi in timeline.`, c.id); }
    catch (e) { setMsg({ t: (e as Error).message, err: true }); }
    setBusy(false);
  };
  const scarta = async (m: LeadInbound) => {
    if (!window.confirm('Togliere questo messaggio dalla lista? Resta in Assistenza com’e’.')) return;
    setBusy(true); setMsg(null);
    try { await inboundScarta({ conv_id: m.conv_id, chi: who }); await fatto('Tolto dalla lista: non e’ un negozio.'); }
    catch (e) { setMsg({ t: (e as Error).message, err: true }); }
    setBusy(false);
  };
  const apriForm = (m: LeadInbound | null) => setForm({ convId: m?.conv_id ?? null, nome: m?.customer_name ?? '', citta: '', tipo: 'boutique', email: m?.customer_email ?? '', telefono: '', ig: '', website: '', canale: 'instagram_dm', referente: '', nota: '', duplicati: [] });
  const salva = async (forza: boolean) => {
    if (!form) return;
    setBusy(true); setMsg(null);
    const dati = { nome: form.nome, citta: form.citta, tipo: form.tipo, email: form.email, telefono: form.telefono, ig_handle: form.ig, website: form.website, referente: form.referente, nota: form.nota, forza, chi: who };
    try {
      const r = form.convId ? await inboundCrea({ ...dati, conv_id: form.convId }) : await nuovoNegozio({ ...dati, canale: form.canale });
      setForm(null);
      await fatto(`Negozio ${form.nome} creato.`, r.account_id);
    } catch (e) {
      const dup = ((e as Error & { dati?: { duplicati?: NegozioCandidato[] } }).dati?.duplicati) ?? [];
      if (dup.length) setForm({ ...form, duplicati: dup });
      setMsg({ t: (e as Error).message, err: true });
    }
    setBusy(false);
  };
  const campo = (k: keyof FormNegozio, label: string, extra: Record<string, unknown> = {}) => (
    <label className="cs-fld">{label}<input value={String(form?.[k] ?? '')} onChange={(e) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f))} {...extra} /></label>
  );
  const modulo = form && (
    <div className="or-inbound-form">
      <h3>{form.convId ? 'Crea il negozio da questo messaggio' : 'Nuovo negozio'}</h3>
      {campo('nome', 'Nome del negozio')}
      {campo('citta', 'Citta’')}
      <label className="cs-fld">Tipo<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>{Object.entries(TIPO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {!form.convId && <label className="cs-fld">Come ci ha contattato<select value={form.canale} onChange={(e) => setForm({ ...form, canale: e.target.value })}>{Object.entries(CANALI_INGRESSO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
      {campo('email', 'Email', { type: 'email' })}
      {!form.convId && campo('telefono', 'Telefono')}
      {!form.convId && campo('referente', 'Referente (nome)')}
      {campo('ig', 'Instagram (handle)')}
      {campo('website', 'Sito')}
      {!form.convId && <label className="cs-fld">Cosa ci siamo detti<textarea rows={3} value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} /></label>}
      {form.duplicati.length > 0 && <div className="note">
        <b>Potrebbe essere gia’ qui:</b>
        {form.duplicati.map((d) => <div key={d.id} className="row"><div><div className="rt">{d.nome}{d.citta ? ` · ${d.citta}` : ''}</div><div className="rs">{viaLabel[d.via] ?? d.via}</div></div>
          {form.convId && inbound ? <button type="button" className="ds-btn" disabled={busy} onClick={() => { const m = inbound.find((x) => x.conv_id === form.convId); if (m) void collega(m, d); }}>Collega a questo</button> : <button type="button" className="ds-btn" disabled={busy} onClick={() => { setForm(null); onOpen(d.id); }}>Apri</button>}
        </div>)}
      </div>}
      <div className="lead-actions">
        <button type="button" className="ds-btn" disabled={busy || form.nome.trim().length < 2} onClick={() => void salva(form.duplicati.length > 0)}>{form.duplicati.length ? 'Crea comunque un negozio nuovo' : 'Crea negozio'}</button>
        <button type="button" className="ds-btn" disabled={busy} onClick={() => setForm(null)}>Annulla</button>
      </div>
    </div>
  );
  return (
    <section className="card">
      <div className="or-inbound-head"><h2>Messaggi da collegare{inbound ? ` · ${inbound.length}` : ''}</h2><button type="button" className="ds-btn" disabled={busy} onClick={() => apriForm(null)}>Nuovo negozio</button></div>
      <p className="note">Moduli del sito e email a wholesale@ arrivati in Assistenza negli ultimi 30 giorni, e messaggi da indirizzi gia’ noti, non ancora nella timeline di un negozio.</p>
      {form && !form.convId && modulo}
      {!inbound ? <p className="muted">Carico…</p> : !inbound.length ? <p className="muted">Nessun messaggio da collegare.</p> : <div className="or-list">{inbound.map((m) => (
        <div key={m.conv_id} className="or-inbound">
          <div className="rt"><b>{m.customer_name || m.customer_email || 'mittente sconosciuto'}</b>{m.customer_email && m.customer_name ? ` · ${m.customer_email}` : ''} · {fmtDT(m.last_msg_at)}{m.da_modulo ? ' · modulo del sito' : ''}{m.a_wholesale ? ' · a wholesale@' : ''}</div>
          <div className="rs">{m.subject ? <b>{m.subject} </b> : null}{m.snippet}</div>
          <div className="lead-actions">
            {m.candidati.map((c) => <button key={c.id} type="button" className="ds-btn" disabled={busy} title={viaLabel[c.via] ?? c.via} onClick={() => void collega(m, c)}>Collega a {c.nome}{c.citta ? ` (${c.citta})` : ''}</button>)}
            <button type="button" className="ds-btn" disabled={busy} onClick={() => apriForm(m)}>Crea negozio</button>
            <button type="button" className="or-link" disabled={busy} onClick={() => void scarta(m)}>Non e’ un negozio</button>
          </div>
          {form?.convId === m.conv_id && modulo}
        </div>
      ))}</div>}
      <div className="or-esito" aria-live="polite">{msg && <div className={msg.err ? 'err' : 'note'} style={{ marginTop: 8 }}>{msg.t}</div>}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
export function OutreachCoda({ rows, onOpen, who, onChanged, aiOn }: { rows: LeadOutreach[]; onOpen: (id: string) => void; who: string; onChanged: () => Promise<void>; aiOn: boolean }) {
  const risposte = rows.filter((r) => r.da_gestire);
  // follow-up gia' scritti dal giro automatico (migr 0148): manca solo la rilettura e il click di invio
  const pronti = rows.filter((r) => r.bozza_auto_tocco != null && !r.da_gestire);
  const scadute = rows.filter((r) => r.scaduta && !r.da_gestire && r.bozza_auto_tocco == null);
  const inScadenza = rows.filter((r) => !r.scaduta && r.bozza_auto_tocco == null && r.prossima_azione_at && r.prossima_azione_at <= addDays(2));
  const nuovi = rows.filter((r) => r.lead_stage === 'da_contattare' && !r.n_tocchi);
  const Row = ({ r, icon, what }: { r: LeadOutreach; icon: string; what: string }) => (
    <button type="button" className="or-row" onClick={() => onOpen(r.id)}>
      <span className="or-ico">{icon}</span>
      <span className="or-t"><b>{r.nome}</b><small>{what}</small></span>
      <span className="or-go">Apri ›</span>
    </button>
  );
  const empty = !risposte.length && !pronti.length && !scadute.length && !inScadenza.length && !nuovi.length;
  return (
    <>
      {aiOn && <InboundCoda who={who} onChanged={onChanged} onOpen={onOpen} />}
      {empty && <section className="card"><p className="muted">Niente da fare oggi. Bel lavoro.</p></section>}
      {risposte.length > 0 && <section className="card"><h2>Risposte da gestire · {risposte.length}</h2><div className="or-list">{risposte.map((r) => <Row key={r.id} r={r} icon="📩" what={`${CANALI[r.ultimo_canale ?? ''] ?? ''} ricevuta ${fmtD(r.ultimo_tocco_at)}${r.ultimo_esito ? ` · ${ESITI.find((e) => e.key === r.ultimo_esito)?.label ?? r.ultimo_esito}` : ''}`} />)}</div></section>}
      {pronti.length > 0 && <section className="card"><h2>Follow-up pronti da rivedere · {pronti.length}</h2><div className="or-list">{pronti.map((r) => <Row key={r.id} r={r} icon="✍️" what={`bozza del follow-up ${r.bozza_auto_tocco} di 4 gia’ scritta: rileggila e inviala`} />)}</div></section>}
      {scadute.length > 0 && <section className="card"><h2>Azioni scadute · {scadute.length}</h2><div className="or-list">{scadute.map((r) => <Row key={r.id} r={r} icon="⏰" what={`${r.prossima_azione ?? 'azione'} · scaduta il ${fmtD(r.prossima_azione_at)} · ${r.owner_outreach ?? ''}`} />)}</div></section>}
      {inScadenza.length > 0 && <section className="card"><h2>In scadenza entro 2 giorni · {inScadenza.length}</h2><div className="or-list">{inScadenza.map((r) => <Row key={r.id} r={r} icon="📅" what={`${r.prossima_azione ?? 'azione'} · ${fmtD(r.prossima_azione_at)}`} />)}</div></section>}
      {nuovi.length > 0 && <section className="card"><h2>Da contattare, mai toccati · {nuovi.length}</h2><div className="or-list">{nuovi.map((r) => <Row key={r.id} r={r} icon={r.telefono_maps || r.telefono ? '📞' : '✍️'} what={r.telefono_maps || r.telefono ? `telefonata di qualifica (${r.telefono ?? r.telefono_maps})` : r.email_generica || r.email_sito ? `email 1 a ${r.email_generica ?? r.email_sito}` : 'nessun contatto trovato: cercare email o telefono'} />)}</div></section>}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
export function OutreachScheda({ r, urls, who, sequences, settings, onBack, onOpenDossier, onChanged }: { r: LeadOutreach; urls: Record<string, string>; who: string; sequences: LeadSequence[]; settings: Record<string, string>; onBack: () => void; onOpenDossier: (id: string) => void; onChanged: () => Promise<void> }) {
  const [touches, setTouches] = useState<LeadTouch[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // registra tocco
  const [canale, setCanale] = useState('telefono');
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [esito, setEsito] = useState('');
  const [stageDopo, setStageDopo] = useState('');
  const [pa, setPa] = useState('');
  const [paAt, setPaAt] = useState('');
  // compositore
  const [codice, setCodice] = useState(r.paese === 'IT' ? 'boutique_it' : 'boutique_en');
  const [tocco, setTocco] = useState<number>(Math.min(4, (r.n_email_out || 0) + 1));
  const [referente, setReferente] = useState('');
  const [testo, setTesto] = useState('');
  const [oggetto, setOggetto] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const firma = settings.lead_firma ?? 'Benedetta - Amimì Milano';
  const linesheet = settings.lead_linesheet_url ?? '';
  const [to, setTo] = useState(r.email_generica ?? r.email_sito ?? '');
  // bozza AI (edge lead-outreach): quando c'e' una bozza aperta il template non sovrascrive piu' il testo
  const aiOn = settings.lead_outreach_ai_enabled === 'true';
  const [drafts, setDrafts] = useState<LeadDraft[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [sendKey, setSendKey] = useState('');
  const [avvisi, setAvvisi] = useState<string[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  // esito delle azioni del compositore, mostrato IN FONDO al compositore, accanto ai bottoni: `msg` sta in cima alla
  // scheda, e con il bottone Invia a schermo non si vede (08-10: un invio rifiutato e' sembrato un'email mai arrivata)
  const [cmsg, setCmsg] = useState<{ t: string; err: boolean } | null>(null);
  const dire = (t: string, err = false) => setCmsg(t ? { t, err } : null);
  const [provaBusy, setProvaBusy] = useState(false);
  // v11 (blocco A3): collegare un tocco registrato a mano all'email partita da Gmail, scegliendola fra quelle di Posta inviata
  // v12 (blocco B): riquadro "Rispondi" per i negozi che ci hanno scritto. Testo della persona, nessun numero di tocco.
  const [rTo, setRTo] = useState('');
  const [rOggetto, setROggetto] = useState('');
  const [rTesto, setRTesto] = useState('');
  const [rKey, setRKey] = useState(() => crypto.randomUUID());
  const [rBusy, setRBusy] = useState(false);
  const [rMsg, setRMsg] = useState<{ t: string; err: boolean } | null>(null);
  const [rPronto, setRPronto] = useState(false);   // destinatario e oggetto riempiti una volta: poi decide la persona
  const [collega, setCollega] = useState<{ touchId: string; stato: 'carico' | 'pronto' | 'errore'; candidati: InviataCandidata[]; nota: string } | null>(null);

  const apriBozza = (d: LeadDraft) => {
    setCmsg(null);   // l'esito della bozza di prima non deve restare sotto il bottone Invia di questa
    if (d.sequenza_tocco != null) setTocco(d.sequenza_tocco);
    if (d.lingua === 'en' || d.lingua === 'it') setCodice(d.lingua === 'en' ? 'boutique_en' : 'boutique_it');
    setDraftId(d.id); setSendKey(crypto.randomUUID());
    setOggetto(d.oggetto ?? ''); setTesto(d.testo); if (d.to_email) setTo(d.to_email);
    setAvvisi(d.fatti_usati?.avvisi ?? []);
  };
  const reload = async () => { setTouches(await fetchTouches(r.id)); const ds = await fetchDrafts(r.id); setDrafts(ds); return ds; };
  // dopo una scrittura RIUSCITA la scheda si ricarica: se il ricarico fallisce l'azione resta fatta, e l'esito lo dice
  // invece di sembrare un errore dell'azione (un invio partito non deve mai leggersi come fallito)
  const ricarica = async (): Promise<string> => { try { await onChanged(); await reload(); return ''; } catch { return ' La scheda non si e’ aggiornata: ricarica la pagina per vedere la timeline.'; } };
  // all'apertura: se il giro automatico ha gia' scritto il follow-up di questo negozio, il compositore parte da li'
  useEffect(() => {
    setTouches(null); setDraftId(null); setCmsg(null);
    reload().then((ds) => {
      const auto = r.bozza_auto_tocco != null ? ds.find((d) => d.origine === 'auto' && d.stato === 'proposta' && d.sequenza_tocco === r.bozza_auto_tocco) : undefined;
      if (auto) { apriBozza(auto); setMsg(`Follow-up ${auto.sequenza_tocco} scritto in automatico alla scadenza: rileggilo, correggilo e invialo (o scartalo).`); }
    }).catch((e: Error) => setMsg(e.message));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [r.id]);
  const scarta = async () => {
    if (!draftId) return;
    setBusy(true); dire('');
    try { await scartaBozza({ draft_id: draftId, chi: who }); setDraftId(null); setAvvisi([]); dire('Bozza scartata.' + (await ricarica())); } catch (e) { dire((e as Error).message, true); }
    setBusy(false);
  };

  const seq = useMemo(() => sequences.find((s) => s.codice === codice && s.tocco === tocco) ?? null, [sequences, codice, tocco]);
  useEffect(() => {
    if (draftId) return;
    if (!seq) { setTesto(''); setOggetto(''); return; }
    setTesto(renderTemplate(seq.corpo, r, referente, firma, linesheet));
    setOggetto(seq.oggetto ? renderTemplate(seq.oggetto, r, referente, firma, linesheet) : '');
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [seq?.id, referente, r.id, draftId, firma, linesheet]);

  const bozzaAI = async () => {
    if (seq?.canale !== 'email') { dire('La bozza AI e’ per i tocchi email (1-4).', true); return; }
    setAiBusy(true); dire('');
    try {
      const d = await generaBozza({ account_id: r.id, tocco, referente: referente || undefined, lingua: codice.endsWith('_en') ? 'en' : 'it', chi: who });
      setDraftId(d.draft_id); setSendKey(crypto.randomUUID());
      setOggetto(d.oggetto); setTesto(d.testo); if (d.to && !to) setTo(d.to);
      setAvvisi(d.avvisi ?? []);
      dire(d.segnaposto.length ? `Bozza pronta. Completa le ${d.segnaposto.length} parti fra parentesi quadre prima di inviare.` : 'Bozza pronta: rileggila e correggila prima di inviare.');
      setDrafts(await fetchDrafts(r.id));
    } catch (e) { dire((e as Error).message, true); }
    setAiBusy(false);
  };
  const residui = segnaposto(`${oggetto}\n${testo}`);
  const toInterno = indirizzoInterno(to);
  const invia = async () => {
    if (!draftId) return;
    if (!window.confirm(`Inviare adesso da ${LEAD_MITTENTE}?\n\nA: ${to}\nOggetto: ${oggetto}\n\nL'email parte davvero e non si puo' richiamare.`)) return;
    setBusy(true); dire('');
    try {
      const res = await inviaBozza({ draft_id: draftId, send_key: sendKey, to, oggetto, testo, chi: who });
      setDraftId(null); setAvvisi([]);
      dire(`${res.already_sent ? 'Gia’ inviata prima' : 'Inviata'} a ${res.to}${res.from ? ` da ${res.from}` : ''}.${res.prossimo ? ` Follow-up in coda per il ${fmtD(res.prossimo)}.` : ''}${res.warnings?.length ? ' Attenzione: ' + res.warnings.join(' ') : ''}${await ricarica()}`);
      setTocco((t) => Math.min(4, t + 1));
    } catch (e) { dire((e as Error).message, true); }
    setBusy(false);
  };
  // prova: il testo che c'e' ADESSO nel box, alla casella di chi e' loggato. Non e' un invio: niente tocco, niente tetto.
  // Stato suo (provaBusy): durante una prova il bottone Invia non deve leggere "Invio…".
  const prova = async () => {
    setProvaBusy(true); dire('');
    try {
      const res = await inviaProva({ oggetto, testo });
      dire(`Prova inviata a ${res.to}${res.from ? ` da ${res.from}` : ''}: la trovi in Posta in arrivo con “[PROVA]” nell’oggetto. Non conta come invio: bozza, tocchi e tetto restano come prima.${res.segnaposto ? ` Nel testo restano ${res.segnaposto} parti fra parentesi da completare.` : ''}${res.warnings?.length ? ' Attenzione: ' + res.warnings.join(' ') : ''}`);
    } catch (e) { dire((e as Error).message, true); }
    setProvaBusy(false);
  };

  // torna l'id del tocco solo se e' stato scritto: chi chiama pulisce il modulo o avanza il tocco SOLO in quel caso
  const save = async (t: Parameters<typeof addTouch>[0], ok: string, out: (s: string, err?: boolean) => void = setMsg): Promise<string | null> => {
    setBusy(true); out('');
    let id: string | null = null;
    try { id = await addTouch(t); out(ok + (await ricarica())); } catch (e) { out((e as Error).message, true); }
    setBusy(false);
    return id;
  };
  // v11 (A3): i candidati di Posta inviata per un tocco email senza thread. Nessuna scelta automatica, anche con un solo candidato.
  const apriCollega = async (touchId: string) => {
    setCollega({ touchId, stato: 'carico', candidati: [], nota: '' });
    try {
      const res = await cercaInviate(touchId);
      const nota = res.gia_agganciato ? 'Gia’ collegata.' : res.motivo ?? (res.candidati.length ? '' : 'Nessuna email a questo negozio in Posta inviata di info@ nei 3 giorni attorno alla registrazione. Se l’hai appena mandata, Gmail puo’ metterci qualche secondo: premi “Cerca di nuovo”. Se e’ partita da un’altra casella, le risposte non si leggono da qui: registrale con “Registra un tocco”.');
      setCollega({ touchId, stato: 'pronto', candidati: res.candidati, nota });
    } catch (e) { setCollega({ touchId, stato: 'errore', candidati: [], nota: (e as Error).message }); }
  };
  const collegaA = async (touchId: string, gmailId: string) => {
    setBusy(true);
    try {
      await agganciaTocco({ touch_id: touchId, gmail_message_id: gmailId, chi: who });
      setCollega(null);
      setMsg('Email collegata: le risposte del negozio a quell’email entrano in timeline al prossimo giro automatico (entro mezz’ora).' + (await ricarica()));
    } catch (e) { setCollega((c) => (c ? { ...c, stato: 'errore', nota: (e as Error).message } : c)); }
    setBusy(false);
  };
  const registra = () => save({ account_id: r.id, canale, direzione: dir, subject: subject || null, body_clean: body || null, stage_prima: r.lead_stage, stage_dopo: stageDopo || null, esito: esito || null, prossima_azione: pa || null, prossima_azione_at: paAt || null, chi: who }, 'Tocco registrato.').then((ok) => { if (!ok) return; setSubject(''); setBody(''); setEsito(''); setStageDopo(''); setPa(''); setPaAt(''); });
  // v12 (blocco B): chi ci ha scritto riceve la risposta dal cruscotto. La preparazione (destinatario, oggetto, thread) e'
  // la stessa regola della edge; riempie i campi una volta sola, poi i campi sono della persona.
  const ciHaScrittoOra = negozioCiHaScritto(touches ?? []);
  const prep = touches ? rispostaPreparata(touches, r.nome, r.email_generica ?? r.email_sito ?? '') : null;
  const mostraRispondi = aiOn && !!touches && ciHaScrittoOra && r.lead_stage !== 'opt_out' && r.lead_stage !== 'chiuso_no' && r.n_opt_out === 0;
  useEffect(() => {
    if (!prep || rPronto) return;
    setRTo(prep.to); setROggetto(prep.oggetto); setRTesto(`\n\n${firma}`); setRPronto(true);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [touches, rPronto]);
  const avvisiR = avvisiTesto(rTesto);
  const residuiR = segnaposto(`${rOggetto}\n${rTesto}`);
  const toInternoR = indirizzoInterno(rTo);
  const testoVuotoR = !rTesto.trim() || rTesto.trim() === firma.trim();
  const inviaRisp = async () => {
    if (!window.confirm(`Inviare la risposta adesso da ${LEAD_MITTENTE}?\n\nA: ${rTo}\nOggetto: ${rOggetto}\n\nL'email parte davvero e non si puo' richiamare.`)) return;
    setRBusy(true); setRMsg(null);
    try {
      const res = await inviaRisposta({ account_id: r.id, to: rTo, oggetto: rOggetto, testo: rTesto, send_key: rKey, chi: who });
      setRKey(crypto.randomUUID()); setRTesto(`\n\n${firma}`); setRPronto(false);
      setRMsg({ t: `${res.already_sent ? 'Gia\u2019 inviata prima' : 'Risposta inviata'} a ${res.to}${res.from ? ` da ${res.from}` : ''}${res.nel_thread ? ', nel thread della conversazione' : ', come email nuova'}. Prossima azione: attesa risposta fra 5 giorni.${res.warnings?.length ? ' Attenzione: ' + res.warnings.join(' ') : ''}${await ricarica()}`, err: false });
    } catch (e) {
      // un esito incerto tiene la chiave: ripremere non deve far ripartire l'email finche' non si guarda Posta inviata
      if (!(e as Error & { incerto?: boolean }).incerto) setRKey(crypto.randomUUID());
      setRMsg({ t: (e as Error).message, err: true });
    }
    setRBusy(false);
  };
  const provaRisp = async () => {
    setRBusy(true); setRMsg(null);
    try {
      const res = await inviaProva({ oggetto: rOggetto, testo: rTesto });
      setRMsg({ t: `Prova inviata a ${res.to}: la trovi in Posta in arrivo con \u201c[PROVA]\u201d nell\u2019oggetto. Non conta come invio.`, err: false });
    } catch (e) { setRMsg({ t: (e as Error).message, err: true }); }
    setRBusy(false);
  };

  // v11 (A4): a un negozio che ci ha gia' scritto "Segna come inviata" non registra un tocco della sequenza a freddo
  const segnaInviata = () => {
    const canaleT = seq?.canale ?? 'email';
    const next = sequences.find((s) => s.codice === codice && s.tocco === tocco + 1 && s.canale === 'email');
    const d = dopoInvioManuale({ ciHaScritto: negozioCiHaScritto(touches ?? []), email: canaleT === 'email', tocco, prossimo: next ? { tocco: next.tocco, giorni_attesa: next.giorni_attesa } : null, oggi: new Date() });
    return save({ account_id: r.id, canale: canaleT, direzione: 'out', subject: oggetto || null, body_clean: testo, stage_prima: r.lead_stage, stage_dopo: r.lead_stage === 'da_contattare' ? 'contattato' : null, sequenza_tocco: d.sequenza_tocco, prossima_azione: d.prossima_azione, prossima_azione_at: d.prossima_azione_at, chi: who }, d.messaggio, dire).then((id) => {
      if (!id) return;
      if (d.avanzaTocco) setTocco((t) => Math.min(4, t + 1));
      // subito dopo la registrazione si sceglie l'email partita da Gmail, cosi' il giro ne legge le risposte
      if (canaleT === 'email' && aiOn) void apriCollega(id);
    });
  };
  const sposta = () => moveTo && save({ account_id: r.id, canale: 'altro', direzione: 'out', body_clean: `Spostato a "${STAGE_LABEL[moveTo]}" da ${who}`, stage_prima: r.lead_stage, stage_dopo: moveTo, chi: who }, `Spostato in ${STAGE_LABEL[moveTo]}.`).then((ok) => { if (ok) setMoveTo(''); });
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(oggetto)}&body=${encodeURIComponent(testo)}`;
  const copia = async () => { try { await navigator.clipboard.writeText(`${oggetto ? oggetto + '\n\n' : ''}${testo}`); dire('Testo copiato.'); } catch { dire('Copia non riuscita: seleziona e copia a mano.', true); } };

  return (
    <div className="screen">
      <header>
        <button className="lead-back" onClick={onBack} type="button">‹ Pipeline</button>
        <span className="badge" style={{ background: 'var(--interactive-700)', color: '#fff' }}>{STAGE_LABEL[r.lead_stage]}</span>
      </header>
      <div className="or-head">
        {r.thumb && urls[r.thumb] ? <img src={urls[r.thumb]} alt="" /> : <span className="or-thumb-empty big" />}
        <div>
          <h1 style={{ margin: 0 }}>{r.nome}</h1>
          <div className="muted">{[TIPO_LABEL[r.tipo] ?? r.tipo, r.citta, r.paese !== 'IT' ? r.paese : null, r.tier ? `Tier ${r.tier}` : r.tier_proposto ? `proposto ${r.tier_proposto}` : null, r.totale != null ? `score ${r.totale}` : null, r.follower != null ? `IG ${new Intl.NumberFormat('it-IT').format(r.follower)}` : null].filter(Boolean).join(' · ')}</div>
          <div className="lead-links" style={{ marginTop: 6 }}>
            {to && <a href={`mailto:${to}`}>{to}</a>}
            {(r.telefono ?? r.telefono_maps) && <span>{r.telefono ?? r.telefono_maps}</span>}
            {r.website && <a href={r.website} target="_blank" rel="noreferrer">sito</a>}
            {r.ig_handle && <a href={`https://www.instagram.com/${r.ig_handle}/`} target="_blank" rel="noreferrer">@{r.ig_handle}</a>}
            <button type="button" className="or-link" onClick={() => onOpenDossier(r.id)}>Apri il dossier ›</button>
          </div>
          {r.verdetto && <div className="note" style={{ marginTop: 4 }}><b>{VERDETTO_LABEL[r.verdetto]}</b>{r.verdetto_motivo ? `: ${r.verdetto_motivo}` : ''}</div>}
          {r.n_opt_out > 0 && <div className="err" style={{ marginTop: 4 }}>OPT-OUT registrato: non contattare.</div>}
        </div>
      </div>
      {r.gancio && <div className="lead-gancio"><b>Gancio dal dossier</b><p>{r.gancio}</p></div>}
      <div className="or-next">
        <div><b>Prossima azione:</b> {r.prossima_azione ? `${r.prossima_azione}${r.prossima_azione_at ? ` entro il ${fmtD(r.prossima_azione_at)}` : ''}` : 'nessuna pianificata'}{r.owner_outreach ? ` · segue ${r.owner_outreach}` : ''}</div>
        <div className="or-move"><select value={moveTo} aria-label="Sposta in un altro stadio" onChange={(e) => setMoveTo(e.target.value)}><option value="">Sposta a…</option>{STAGES.map((s) => <option key={s.key} value={s.key} disabled={s.key === r.lead_stage}>{s.label}</option>)}</select><button type="button" className="ds-btn" disabled={!moveTo || busy} onClick={sposta}>Sposta</button></div>
      </div>
      {msg && <div className="note" style={{ margin: '4px 0' }}>{msg}</div>}

      {/* su telefono il compositore viene PRIMA della timeline (CSS order): e' il passo che serve per la prima email */}
      <div className="or-two">
        <section className="card">
          <h2>Timeline</h2>
          {mostraRispondi && prep && <div className="or-rispondi">
            <h3>Rispondi a {r.nome}</h3>
            <p className="note">{prep.nelThread && prep.riferimento ? `Nel thread di \u201c${prep.riferimento.subject || '(senza oggetto)'}\u201d del ${fmtDT(prep.riferimento.at)}: il negozio la riceve come risposta.` : 'Email nuova: l\u2019ultimo messaggio e\u2019 il modulo del sito, che non ha un thread da riprendere.'} Non conta nel tetto giornaliero e non serve la riga di opt-out.</p>
            <label className="cs-fld">Destinatario<input type="email" value={rTo} onChange={(e) => setRTo(e.target.value.trim())} /></label>
            <label className="cs-fld">Oggetto<input value={rOggetto} onChange={(e) => setROggetto(e.target.value)} /></label>
            <label className="cs-fld">Risposta<textarea rows={7} value={rTesto} onChange={(e) => setRTesto(e.target.value)} placeholder="Scrivi qui la risposta" /></label>
            {avvisiR.length > 0 && <div className="err" style={{ marginTop: 6 }}>Da controllare: {avvisiR.join(' \u00b7 ')}</div>}
            {residuiR.length > 0 && <p className="note">Prima di inviare completa: {residuiR.slice(0, 4).join(' ')}</p>}
            {toInternoR && <p className="note">Gli indirizzi @amimi.it non ricevono l\u2019invio vero: usa \u201cProva della risposta a me\u201d.</p>}
            <div className="lead-actions">
              <button type="button" className="ds-btn" disabled={rBusy || busy || !rTo || toInternoR || residuiR.length > 0 || testoVuotoR || !rOggetto.trim()} style={{ background: 'var(--positive-700)', color: '#fff', borderColor: 'var(--positive-700)' }} onClick={() => void inviaRisp()}>{rBusy ? 'Invio\u2026' : `Invia risposta da ${LEAD_MITTENTE}`}</button>
              <button type="button" className="ds-btn" disabled={rBusy || !rOggetto.trim() || testoVuotoR} onClick={() => void provaRisp()}>Prova della risposta a me</button>
            </div>
            <div className="or-esito" aria-live="polite">{rMsg && <div className={rMsg.err ? 'err' : 'note'} style={{ marginTop: 8 }}>{rMsg.t}</div>}</div>
          </div>}
          {!touches ? <p className="muted">Carico…</p> : !touches.length ? <p className="muted">Nessun tocco ancora. Il primo lo registri qui a destra, o lo mandi dal compositore.</p> : (
            <div className="or-timeline">{touches.map((t) => (
              <div key={t.id} className={`or-ev ${t.direzione === 'in' ? 'in' : ''} ${t.canale === 'telefono' || t.canale === 'visita' ? 'call' : ''}`}>
                <div className="h">{fmtDT(t.at)} · {CANALI[t.canale] ?? t.canale} {t.direzione === 'in' ? 'ricevuta' : t.canale === 'altro' ? '' : 'inviata'}{t.sequenza_tocco != null ? ` · tocco ${t.sequenza_tocco}` : ''}{t.chi ? ` · ${t.chi}` : ''}{t.esito ? ` · ${ESITI.find((e) => e.key === t.esito)?.label ?? t.esito}` : ''}{t.stage_dopo ? ` → ${STAGE_LABEL[t.stage_dopo] ?? t.stage_dopo}` : ''}</div>
                {(t.subject || t.body_clean) && <div className="b">{t.subject ? <b>{t.subject}{'\n'}</b> : null}{t.body_clean}</div>}
                {(t.prossima_azione || t.prossima_azione_at) && <div className="h">prossima: {t.prossima_azione ?? ''} {t.prossima_azione_at ? fmtD(t.prossima_azione_at) : ''}</div>}
                {aiOn && t.direzione === 'out' && t.canale === 'email' && !t.gmail_thread_id && collega?.touchId !== t.id && <button type="button" className="or-link" disabled={busy} onClick={() => void apriCollega(t.id)} title="Senza il collegamento il giro automatico non legge le risposte a questa email">Collega a Gmail</button>}
                {collega?.touchId === t.id && <div className="or-collega" aria-live="polite">
                  {collega.stato === 'carico' && <p className="muted">Cerco in Posta inviata di info@…</p>}
                  {collega.stato !== 'carico' && collega.nota && <p className={collega.stato === 'errore' ? 'err' : 'note'}>{collega.nota}</p>}
                  {collega.stato === 'pronto' && collega.candidati.length > 0 && <>
                    <p className="note">Quale di queste email hai registrato? Scegli quella giusta: le risposte a quella entreranno in timeline.</p>
                    {collega.candidati.map((c) => <div key={c.gmail_message_id} className="row"><div><div className="rt">{c.oggetto || '(senza oggetto)'}</div><div className="rs">{fmtDT(c.data)} · a {c.a}</div></div><button type="button" className="ds-btn" disabled={busy} onClick={() => void collegaA(t.id, c.gmail_message_id)}>Collega</button></div>)}
                  </>}
                  {collega.stato !== 'carico' && <button type="button" className="or-link" disabled={busy} onClick={() => void apriCollega(t.id)} style={{ marginRight: 12 }}>Cerca di nuovo</button>}<button type="button" className="or-link" disabled={busy} onClick={() => setCollega(null)}>Chiudi</button>
                </div>}
              </div>
            ))}</div>
          )}
          <h2 style={{ marginTop: 14 }}>Registra un tocco</h2>
          <div className="or-form">
            <label>Canale<select value={canale} onChange={(e) => setCanale(e.target.value)}>{Object.entries(CANALI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Direzione<select value={dir} onChange={(e) => setDir(e.target.value as 'in' | 'out')}><option value="out">Noi → loro</option><option value="in">Loro → noi</option></select></label>
            <label className="wide">Oggetto / titolo<input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="es. telefonata con Valentina" /></label>
            <label className="wide">Cosa ci siamo detti<textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Riassunto, o il testo della risposta ricevuta" /></label>
            <label>Esito<select value={esito} onChange={(e) => setEsito(e.target.value)}><option value="">—</option>{ESITI.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select></label>
            <label>Stadio dopo<select value={stageDopo} onChange={(e) => setStageDopo(e.target.value)}><option value="">automatico</option>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
            <label>Prossima azione<input value={pa} onChange={(e) => setPa(e.target.value)} placeholder="es. mandare catalogo" /></label>
            <label>Entro il<input type="date" value={paAt} onChange={(e) => setPaAt(e.target.value)} min={today()} /></label>
          </div>
          <button type="button" className="ds-btn" disabled={busy} onClick={registra}>Registra ({who})</button>
        </section>

        <section className="card or-compositore">
          <h2>Compositore</h2>
          {mostraRispondi && <p className="note">Questo negozio ci ha gia\u2019 scritto: per rispondere usa \u201cRispondi\u201d in cima alla timeline. Qui restano la sequenza a freddo e \u201cSegna come inviata\u201d per un\u2019email mandata da Gmail.</p>}
          <div className="or-form">
            <label>Sequenza<select value={codice} onChange={(e) => { setCodice(e.target.value); setCmsg(null); }}>{[...new Set(sequences.map((s) => s.codice))].map((c) => <option key={c} value={c}>{c === 'boutique_it' ? 'Boutique · italiano' : c === 'boutique_en' ? 'Boutique · English' : c}</option>)}</select></label>
            <label>Tocco<select value={tocco} onChange={(e) => { setTocco(Number(e.target.value)); setCmsg(null); }}>{sequences.filter((s) => s.codice === codice).map((s) => <option key={s.tocco} value={s.tocco}>{s.tocco === 0 ? '0 · telefonata' : `${s.tocco} · ${s.canale}${s.giorni_attesa ? ` (+${s.giorni_attesa} gg)` : ''}`}</option>)}</select></label>
            <label className="wide">Referente (nome)<input value={referente} onChange={(e) => setReferente(e.target.value)} placeholder="es. Valentina · vuoto = team di …" /></label>
            {oggetto !== '' || seq?.canale === 'email' ? <label className="wide">Oggetto<input value={oggetto} onChange={(e) => setOggetto(e.target.value)} /></label> : null}
            <label className="wide">Testo<textarea rows={14} value={testo} onChange={(e) => setTesto(e.target.value)} /></label>
          </div>
          <div className="facts-note">{draftId ? 'Bozza scritta dall’AI dal dossier e dal template approvato: e’ una proposta, rileggila tutta.' : 'Riempito dal template con nome, gancio del dossier e firma.'} Le parti fra parentesi quadre vanno sistemate a mano prima di inviare. Tetto invii: {settings.lead_tetto_giornaliero ?? '20'} al giorno.</div>
          {aiOn ? (
            <div className="or-ai">
              <div className="lead-actions">
                <button type="button" className="ds-btn" disabled={aiBusy || busy || seq?.canale !== 'email'} style={{ background: 'var(--interactive-700)', color: '#fff', borderColor: 'var(--interactive-700)' }} onClick={bozzaAI}>{aiBusy ? 'Scrivo la bozza…' : draftId ? 'Rigenera bozza AI' : `Bozza con l’AI (tocco ${tocco})`}</button>
                {draftId && <button type="button" className="ds-btn" disabled={busy} onClick={() => { setDraftId(null); setAvvisi([]); setCmsg(null); }}>Torna al template</button>}
                {draftId && <button type="button" className="ds-btn" disabled={busy} onClick={scarta}>Scarta bozza</button>}
                {seq?.canale === 'email' && <button type="button" className="ds-btn" disabled={busy || aiBusy || provaBusy || !oggetto.trim() || !testo.trim()} title="Manda questo testo alla tua casella, con [PROVA] nell’oggetto: non conta come invio" onClick={prova}>{provaBusy ? 'Mando la prova…' : 'Manda una prova a me'}</button>}
              </div>
              {avvisi.length > 0 && <div className="err" style={{ marginTop: 6 }}>Da controllare: {avvisi.join(' · ')}</div>}
              {draftId && <>
                <label className="cs-fld" style={{ display: 'block', marginTop: 8 }}>Destinatario<input type="email" value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="email del negozio" /></label>
                {toInterno && <p className="note">Gli indirizzi @amimi.it non ricevono l’invio vero, che va solo ai negozi. Per vedere l’email nella tua casella usa “Manda una prova a me”.</p>}
                {residui.length > 0 && <p className="note">Prima di inviare completa: {residui.slice(0, 4).join(' ')}</p>}
                <button type="button" className="ds-btn" disabled={busy || provaBusy || !to || toInterno || residui.length > 0 || r.n_opt_out > 0} style={{ marginTop: 6, background: 'var(--positive-700)', color: '#fff', borderColor: 'var(--positive-700)' }} onClick={invia}>{busy ? 'Invio…' : `Invia da ${LEAD_MITTENTE}`}</button>
              </>}
            </div>
          ) : <p className="note">Bozza AI e invio dall&#8217;app spenti (flag lead_outreach_ai_enabled). Per ora: template, Gmail e &#8220;Segna come inviata&#8221;.</p>}
          {drafts.length > 0 && <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: 13 }}>Bozze di questo negozio ({drafts.length})</summary><div className="list">{drafts.map((d) => <div key={d.id} className="row"><div><div className="rt">{d.sequenza_tocco != null ? `Tocco ${d.sequenza_tocco}` : 'Risposta'} · {d.stato}{d.origine === 'auto' ? ' · automatica' : ''}{d.sent_by ? ` · ${d.sent_by}` : d.chi ? ` · ${d.chi}` : ''}</div><div className="rs">{d.oggetto ?? ''}{d.errore ? ` · ${d.errore}` : ''}</div>{aiOn && d.sequenza_tocco != null && (d.stato === 'proposta' || d.stato === 'errore') && d.id !== draftId && <button type="button" className="or-link" disabled={busy} onClick={() => apriBozza(d)}>Apri nel compositore</button>}{d.stato === 'in_invio' && <button type="button" className="or-link" disabled={busy} onClick={async () => { if (!window.confirm('Hai controllato "Posta inviata" di info@amimi.it e questa email NON c’e’? Solo in quel caso sbloccala.')) return; try { await sbloccaBozza({ draft_id: d.id, chi: who }); dire('Bozza sbloccata: si puo’ reinviare.'); await reload(); } catch (e) { dire((e as Error).message, true); } }}>Sblocca (esito incerto)</button>}</div><div className="muted" style={{ fontSize: 12 }}>{fmtD(d.sent_at ?? d.created_at)}</div></div>)}</div></details>}
          {!draftId && <div className="lead-actions">
            {seq?.canale === 'email' && to && <a className="ds-btn" href={gmailUrl} target="_blank" rel="noreferrer">Apri in Gmail</a>}
            <button type="button" className="ds-btn" onClick={copia}>Copia testo</button>
            {/* secondaria (bordo, non pieno): registra un invio fatto altrove, non lo esegue */}
            <button type="button" className="ds-btn" disabled={busy || !testo || !touches} style={{ color: 'var(--positive-700)', borderColor: 'var(--positive-700)' }} onClick={segnaInviata}>{seq?.canale === 'telefono' ? 'Segna come fatta' : 'Segna come inviata'}</button>
          </div>}
          {!to && seq?.canale === 'email' && <p className="note">Nessuna email in anagrafica: "Apri in Gmail" compare quando c&#8217;e&#8217; un destinatario.</p>}
          {/* contenitore sempre montato: una regione live che compare gia' piena spesso non viene letta */}
          <div className="or-esito" aria-live="polite">{cmsg && <div className={cmsg.err ? 'err' : 'note'} style={{ marginTop: 8 }}>{cmsg.t}</div>}</div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function OutreachSequenze({ sequences, settings }: { sequences: LeadSequence[]; settings: Record<string, string> }) {
  const codici = [...new Set(sequences.map((s) => s.codice))].sort((a, b) => (a.endsWith('_it') ? -1 : b.endsWith('_it') ? 1 : a.localeCompare(b)));
  return (
    <>
      {codici.map((c) => (
        <section className="card" key={c}>
          <h2>{c === 'boutique_it' ? 'Sequenza boutique · italiano' : c === 'boutique_en' ? 'Sequenza boutique · English' : c}</h2>
          <div className="tablewrap"><table className="sortable">
            <thead><tr><th>Tocco</th><th>Quando</th><th>Canale</th><th>Oggetto</th><th>Chi</th></tr></thead>
            <tbody>{sequences.filter((s) => s.codice === c).map((s) => (
              <tr key={s.id}><td>{s.tocco}</td><td className="l">{s.tocco === 0 ? 'prima dell’email, se c’e’ un numero' : s.giorni_attesa ? `+${s.giorni_attesa} giorni dal precedente` : 'subito'}</td><td className="l">{CANALI[s.canale] ?? s.canale}</td><td className="l">{s.oggetto ?? '—'}</td><td className="l">{s.chi_default ?? ''}</td></tr>
            ))}</tbody>
          </table></div>
          {sequences.filter((s) => s.codice === c).map((s) => <details key={s.id} style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', fontSize: 13 }}>Testo del tocco {s.tocco}</summary><pre className="lead-pre" style={{ maxHeight: 300 }}>{s.corpo}</pre></details>)}
        </section>
      ))}
      <section className="card">
        <h2>Impostazioni</h2>
        <div className="list">
          <div className="row"><div className="rt">Casella</div><div className="rs">le email partono come {LEAD_MITTENTE} (alias della casella info@, con ripiego su info@ se l&#8217;alias non e&#8217; attivo); le risposte nello stesso thread le legge il giro automatico</div></div>
          <div className="row"><div className="rt">Firma</div><div className="rs" style={{ whiteSpace: 'pre-line' }}>{settings.lead_firma ?? '—'}</div></div>
          <div className="row"><div className="rt">Tetto invii al giorno</div><div className="rs">{settings.lead_tetto_giornaliero ?? '20'}</div></div>
          <div className="row"><div className="rt">Modulo (flag)</div><div className="rs">lead_enabled = {settings.lead_enabled ?? 'false'}: {settings.lead_enabled === 'true' ? 'ogni 30 minuti il giro automatico legge le risposte dei negozi e, alla scadenza, scrive la bozza del follow-up nella Coda. L’invio resta sempre un tuo click.' : 'giro automatico spento: risposte e follow-up si registrano a mano. Acceso, legge le risposte e propone i follow-up in Coda (mai invii automatici).'}</div></div>
          <div className="row"><div className="rt">Regole</div><div className="rs">Massimo 4 tocchi email, poi stop. Opt-out onorato dal database (esito "Opt-out" su un tocco). Contatto 1:1 personalizzato, riga di opt-out in ogni email.</div></div>
        </div>
        <p className="note">I testi vivono nella tabella lead_sequences: per cambiarli, chiedi a Claude Code o modifica a DB. La firma e il tetto in app_flags (lead_firma, lead_tetto_giornaliero).</p>
      </section>
    </>
  );
}
