// Lettura condivisa per il loop "100 pronti": account + ultimo score per account, e la definizione di PRONTO.
// Pronto = stato scored, ultimo score tier A o B, dati_incompleti false, almeno una email (anagrafica, evidenze o lead_contacts).
// Solo letture, paginate con tutte() di indice.mjs fino al conteggio esatto e con un order stabile (prima la pagina
// "corta" chiudeva il giro, e evidenze e contatti paginavano senza order). Le email segnaposto dei template e le PEC
// non contano (emailCommerciale in priority.mjs).
import { emailCommerciale } from './priority.mjs';
import { tutte } from './indice.mjs';

export async function leggiStato(sb) {
  const accounts = await tutte(() => sb.from('lead_accounts').select('id,nome,citta,fonte_seed,owner_note,stato_ricerca,email_generica,created_at', { count: 'exact' }).order('created_at').order('id'), 'lead_accounts');
  const scores = await tutte(() => sb.from('lead_scores').select('account_id,tier_proposto,dati_incompleti,created_at', { count: 'exact' }).order('created_at').order('id'), 'lead_scores');
  const ultimo = new Map(); for (const s of scores) ultimo.set(s.account_id, s);
  const emailEv = await tutte(() => sb.from('lead_evidence').select('account_id,payload', { count: 'exact' }).in('tipo', ['site_meta', 'contatti_trovati']).order('id'), 'lead_evidence email');
  const conEmail = new Set(emailEv.filter((e) => Array.isArray(e.payload?.emails) && e.payload.emails.some(emailCommerciale)).map((e) => e.account_id));
  const contatti = await tutte(() => sb.from('lead_contacts').select('account_id,email', { count: 'exact' }).not('email', 'is', null).eq('opt_out', false).order('id'), 'lead_contacts');
  for (const c of contatti) if (emailCommerciale(c.email)) conEmail.add(c.account_id);
  // seed gia' tentati dal collector senza successo (evidenza `errore`): next_batch non li ripesca
  const errEv = await tutte(() => sb.from('lead_evidence').select('account_id', { count: 'exact' }).eq('tipo', 'errore').order('id'), 'lead_evidence errore');
  const tentati = new Set(errEv.map((e) => e.account_id));
  const buono = (a) => { const s = ultimo.get(a.id); return a.stato_ricerca === 'scored' && s && ['A', 'B'].includes(s.tier_proposto) && !s.dati_incompleti; };
  const pronto = (a) => buono(a) && (emailCommerciale(a.email_generica) || conEmail.has(a.id));
  // resa per fonte: su quanti giudicati (con uno score) quanti sono A/B completi
  const stats = {};
  for (const a of accounts) {
    if (!ultimo.has(a.id)) continue;
    const k = a.fonte_seed ?? '-'; stats[k] ??= { giudicati: 0, ab: 0 };
    stats[k].giudicati++; if (buono(a)) stats[k].ab++;
  }
  return { accounts, ultimo, stats, pronto, buono, tentati };
}
