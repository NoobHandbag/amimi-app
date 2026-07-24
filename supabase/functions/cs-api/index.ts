// cs-api — tool assistenza clienti: scritture dalla UI, gated dal JWT dell'utente loggato.
// Design 6.2 (categoria correggibile) + 3.4 (l'identita' che firma e' il selettore Benny/Ginni/Ale,
// NON il login). AUTORIZZAZIONE (belt-and-suspenders): la UI non scrive mai diretto via RLS;
//   1) l'Authorization header deve portare un access_token di un UTENTE Supabase Auth reale
//      (getUser lato server: la anon key NON e' un utente -> rifiutata);
//   2) l'email dell'utente deve finire in @amimi.it (stessa postura della RLS cs_*).
//   Solo allora un client service_role esegue la scrittura + l'audit su cs_events.
//
// Azioni (v2, feedback owner 24-07):
//   - set_categoria: correzione manuale della categoria (categoria_source='manuale').
//   - set_stato: workflow della coda -> 'da_fare' (da iniziare) | 'in_corso' (presa in carico da chi)
//       | 'fatto' (conclusa). Scrive stato + stato_by=chi + stato_at. cs_events 'stato'.
//   - add_noise: "non e' un cliente" -> appende il MITTENTE a app_flags.cs_noise_senders (dedup)
//       cosi' le prossime mail finiscono nel rumore, e sposta la conversazione a canale='rumore'
//       (sparisce dalla coda). cs_events 'noise_add'. Il flag e' riletto a runtime da cs-sync.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// Tassonomia (design 6.2 + 14a categoria "Modifica / correzione indirizzo" del 23-07):
// la correzione manuale puo' solo assegnare una di queste, o svuotare.
const CANON = [
  'Spedizione e stato ordine', 'Restock e disponibilita', 'Ritiro, negozio, appuntamenti', 'Codice sconto',
  'Personalizzazione e cerimonia', 'Gift card e account', 'Altro / richiesta varia', 'Reso e rimborso',
  'Cambio e prodotto errato', 'Modifica / correzione indirizzo', 'Info prodotto', 'Riparazione',
  'Pagamento', 'Collaborazioni e B2B',
];
const STATI = new Set(['da_fare', 'in_corso', 'fatto']);
const IDENT: Record<string, string> = { B: 'Benedetta', G: 'Ginevra', A: 'Ale' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1) autorizzazione: access_token utente reale via getUser (la anon key non e' un utente)
  const authz = req.headers.get('Authorization') || '';
  const token = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
  if (!token) return json({ error: 'non autenticato' }, 401);
  const { data: ures, error: uerr } = await createClient(url, anon).auth.getUser(token);
  const user = ures?.user;
  if (uerr || !user) return json({ error: 'sessione non valida' }, 401);
  const email = (user.email || '').toLowerCase();
  if (!email.endsWith('@amimi.it')) return json({ error: 'dominio non ammesso' }, 403);

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  const sb = createClient(url, svc);
  const chiKey = String(body.chi || '').toUpperCase();
  const chi = IDENT[chiKey] || 'ignoto';

  const loadConv = async (convId: string) => {
    if (!UUID_RE.test(convId)) return null;
    const { data } = await sb.from('cs_conversations').select('id,categoria,categoria_source,stato,stato_by,canale,customer_email').eq('id', convId).maybeSingle();
    return data ?? null;
  };

  if (action === 'set_categoria') {
    const convId = String(body.conversation_id || '');
    const ex = await loadConv(convId);
    if (!ex) return json({ error: UUID_RE.test(convId) ? 'conversazione inesistente' : 'conversation_id non valido' }, UUID_RE.test(convId) ? 404 : 422);
    // categoria: una canonica, oppure '' / null per riportare a "da confermare"
    const rawCat = body.categoria == null ? '' : String(body.categoria);
    const categoria = rawCat === '' ? null : (CANON.includes(rawCat) ? rawCat : '__invalid__');
    if (categoria === '__invalid__') return json({ error: 'categoria fuori tassonomia' }, 422);

    const { error: ue } = await sb.from('cs_conversations')
      .update({ categoria, categoria_source: categoria ? 'manuale' : 'ai_low' })
      .eq('id', convId);
    if (ue) return json({ error: 'scrittura fallita: ' + ue.message }, 500);

    await sb.from('cs_events').insert({
      conversation_id: convId, azione: 'categoria_edit', chi,
      dettaglio: { da: ex.categoria, a: categoria, da_source: ex.categoria_source, by_email: email },
    });
    return json({ ok: true, categoria, categoria_source: categoria ? 'manuale' : 'ai_low', chi });
  }

  if (action === 'set_stato') {
    const convId = String(body.conversation_id || '');
    const stato = String(body.stato || '');
    if (!STATI.has(stato)) return json({ error: 'stato non valido (da_fare|in_corso|fatto)' }, 422);
    const ex = await loadConv(convId);
    if (!ex) return json({ error: UUID_RE.test(convId) ? 'conversazione inesistente' : 'conversation_id non valido' }, UUID_RE.test(convId) ? 404 : 422);

    // stato_by: chi la prende in carico / chi la chiude. Tornare a da_fare azzera l'assegnazione.
    const stato_by = stato === 'da_fare' ? null : chi;
    const { error: ue } = await sb.from('cs_conversations')
      .update({ stato, stato_by, stato_at: new Date().toISOString() })
      .eq('id', convId);
    if (ue) return json({ error: 'scrittura fallita: ' + ue.message }, 500);

    await sb.from('cs_events').insert({
      conversation_id: convId, azione: 'stato', chi,
      dettaglio: { da: ex.stato, a: stato, da_by: ex.stato_by, by_email: email },
    });
    return json({ ok: true, stato, stato_by, chi });
  }

  if (action === 'add_noise') {
    const convId = String(body.conversation_id || '');
    const ex = await loadConv(convId);
    if (!ex) return json({ error: UUID_RE.test(convId) ? 'conversazione inesistente' : 'conversation_id non valido' }, UUID_RE.test(convId) ? 404 : 422);
    // mittente da bloccare: dal body (la UI passa il from della mail) o fallback all'email cliente della conv
    const sender = String(body.sender || ex.customer_email || '').trim().toLowerCase();
    if (!sender || sender.length < 4 || !sender.includes('@')) return json({ error: 'mittente non valido' }, 422);
    if (sender.endsWith('@amimi.it')) return json({ error: 'non puoi bloccare @amimi.it' }, 422);

    // append con dedup alla denylist (match substring su From+Subject in cs-sync, riletta a runtime)
    const { data: flag } = await sb.from('app_flags').select('value').eq('key', 'cs_noise_senders').maybeSingle();
    const items = String(flag?.value ?? '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
    const already = items.some((x) => x.toLowerCase() === sender);
    if (!already) {
      items.push(sender);
      const { error: fe } = await sb.from('app_flags').upsert({ key: 'cs_noise_senders', value: items.join('\n') }, { onConflict: 'key' });
      if (fe) return json({ error: 'denylist non aggiornata: ' + fe.message }, 500);
    }
    // la conversazione esce dalla coda: canale='rumore' (resta consultabile nella vista Rumore)
    const { error: ue } = await sb.from('cs_conversations').update({ canale: 'rumore' }).eq('id', convId);
    if (ue) return json({ error: 'scrittura fallita: ' + ue.message }, 500);

    await sb.from('cs_events').insert({
      conversation_id: convId, azione: 'noise_add', chi,
      dettaglio: { sender, gia_presente: already, canale_da: ex.canale, by_email: email },
    });
    return json({ ok: true, sender, gia_presente: already, chi });
  }

  // Configurazione AI (come rispondere): leggi/scrivi le istruzioni del team + stato del motore.
  if (action === 'get_ai_config') {
    const { data } = await sb.from('app_flags').select('key,value').in('key', ['cs_ai_istruzioni', 'cs_ai_model', 'anthropic_api_key']);
    const m: Record<string, string> = {};
    for (const r of data ?? []) m[r.key] = r.value ?? '';
    // provider = solo la PRESENZA della chiave (mai il valore: non esporre segreti alla UI)
    const provider = (m.anthropic_api_key || '').trim() ? 'claude' : 'gemini';
    return json({ ok: true, istruzioni: m.cs_ai_istruzioni ?? '', provider, model: (m.cs_ai_model || 'claude-sonnet-5') });
  }

  if (action === 'set_ai_istruzioni') {
    const istr = String(body.istruzioni ?? '').slice(0, 4000);
    const { error: fe } = await sb.from('app_flags').upsert({ key: 'cs_ai_istruzioni', value: istr }, { onConflict: 'key' });
    if (fe) return json({ error: 'scrittura fallita: ' + fe.message }, 500);
    // audit best-effort (cs_events.conversation_id potrebbe essere NOT NULL: ignora l'esito)
    await sb.from('cs_events').insert({ azione: 'ai_istruzioni', chi, dettaglio: { len: istr.length, by_email: email } });
    return json({ ok: true });
  }

  return json({ error: 'azione sconosciuta: ' + action }, 422);
});
