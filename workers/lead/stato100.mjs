// Lettura condivisa per il loop "100 pronti": account + ultimo score per account, e la definizione di PRONTO.
// Pronto = stato scored, ultimo score tier A o B, dati_incompleti false, almeno una email (anagrafica, evidenze o lead_contacts).
// Solo letture.

async function all(q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

export async function leggiStato(sb) {
  const accounts = await all(() => sb.from('lead_accounts').select('id,nome,citta,fonte_seed,owner_note,stato_ricerca,email_generica,created_at').order('created_at').order('id'));
  const scores = await all(() => sb.from('lead_scores').select('account_id,tier_proposto,dati_incompleti,created_at').order('created_at').order('id'));
  const ultimo = new Map(); for (const s of scores) ultimo.set(s.account_id, s);
  const emailEv = await all(() => sb.from('lead_evidence').select('account_id,payload').in('tipo', ['site_meta', 'contatti_trovati']));
  const conEmail = new Set(emailEv.filter((e) => Array.isArray(e.payload?.emails) && e.payload.emails.length).map((e) => e.account_id));
  const contatti = await all(() => sb.from('lead_contacts').select('account_id,email').not('email', 'is', null).eq('opt_out', false));
  for (const c of contatti) conEmail.add(c.account_id);
  // seed gia' tentati dal collector senza successo (evidenza `errore`): next_batch non li ripesca
  const errEv = await all(() => sb.from('lead_evidence').select('account_id').eq('tipo', 'errore'));
  const tentati = new Set(errEv.map((e) => e.account_id));
  const buono = (a) => { const s = ultimo.get(a.id); return a.stato_ricerca === 'scored' && s && ['A', 'B'].includes(s.tier_proposto) && !s.dati_incompleti; };
  const pronto = (a) => buono(a) && (a.email_generica || conEmail.has(a.id));
  // resa per fonte: su quanti giudicati (con uno score) quanti sono A/B completi
  const stats = {};
  for (const a of accounts) {
    if (!ultimo.has(a.id)) continue;
    const k = a.fonte_seed ?? '-'; stats[k] ??= { giudicati: 0, ab: 0 };
    stats[k].giudicati++; if (buono(a)) stats[k].ab++;
  }
  return { accounts, ultimo, stats, pronto, buono, tentati };
}
