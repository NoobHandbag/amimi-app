// cs-api — tool assistenza clienti, FASE 2: scritture dalla UI, gated dal JWT dell'utente loggato.
// Design 6.2 (categoria correggibile a mano) + 3.4 (l'identita' che firma e' il selettore Benny/Ginni,
// NON il login). Questo e' il PRIMO endpoint di scrittura dalla UI: e' il pattern che servira' anche
// alla Fase 4 per gli stati (da_fare/fatto).
//
// AUTORIZZAZIONE (belt-and-suspenders): NON si aprono le scritture via RLS (la UI non scrive diretto).
//   1) l'Authorization header deve portare un access_token di un UTENTE Supabase Auth reale
//      (getUser lo verifica lato server: la anon key NON e' un utente -> rifiutata);
//   2) l'email dell'utente deve finire in @amimi.it (stessa postura della RLS cs_*).
//   Solo allora un client service_role esegue la scrittura + l'audit. verify_jwt=false: l'auth la
//   facciamo QUI (verify_jwt del platform accetterebbe anche la anon key, che non e' un utente).
//
// Azioni: set_categoria (correzione manuale della categoria, categoria_source='manuale' + cs_events
//   'categoria_edit' con chi = identita' selezionata). Stati/bozze/invio = Fasi 3-4 (fuori scope).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// Tassonomia BLOCCATA (design 6.2): la correzione manuale puo' solo assegnare una di queste, o svuotare.
const CANON = [
  'Spedizione e stato ordine', 'Restock e disponibilita', 'Ritiro, negozio, appuntamenti', 'Codice sconto',
  'Personalizzazione e cerimonia', 'Gift card e account', 'Altro / richiesta varia', 'Reso e rimborso',
  'Cambio e prodotto errato', 'Info prodotto', 'Riparazione', 'Pagamento', 'Collaborazioni e B2B',
];
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

  if (action === 'set_categoria') {
    const convId = String(body.conversation_id || '');
    if (!UUID_RE.test(convId)) return json({ error: 'conversation_id non valido' }, 422);
    // categoria: una canonica, oppure '' / null per riportare a "da confermare"
    const rawCat = body.categoria == null ? '' : String(body.categoria);
    const categoria = rawCat === '' ? null : (CANON.includes(rawCat) ? rawCat : '__invalid__');
    if (categoria === '__invalid__') return json({ error: 'categoria fuori tassonomia' }, 422);
    const chiKey = String(body.chi || '').toUpperCase();
    const chi = IDENT[chiKey] || 'ignoto';

    const { data: ex } = await sb.from('cs_conversations').select('id,categoria,categoria_source').eq('id', convId).maybeSingle();
    if (!ex) return json({ error: 'conversazione inesistente' }, 404);

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

  return json({ error: 'azione sconosciuta: ' + action }, 422);
});
