// mcp — Model Context Protocol server for the Amimì app (Streamable HTTP / JSON-RPC 2.0).
// Lets a Claude (Desktop/Code now; web via an OAuth wrapper later) read the business and act on it.
// Reads use the service-role client; writes are delegated to the existing write-api (validation +
// change_log reused). Bearer-token gated via app_flags.mcp_token. Additive: touches nothing else.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const sb = createClient(SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

const rpc = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
const textResult = (obj: unknown) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });

// ---- tools ----
const TOOLS = [
  { name: 'list_inventory', description: 'Inventario: giacenza, disponibili-da-vendere, su Shopify, valore. Filtri opzionali.',
    inputSchema: { type: 'object', properties: { filtro: { type: 'string', enum: ['attivi', 'da_riordinare', 'esauriti', 'su_shopify'], description: 'opzionale' }, cerca: { type: 'string', description: 'testo nel nome/codice' }, limit: { type: 'number' } } } },
  { name: 'what_to_reorder', description: 'Cosa riprodurre: velocità vendite ultimi 60 giorni + stock + in arrivo, ordinato per urgenza.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'sku_availability', description: 'Disponibilità SKU: acquistabili ora, in-stock-non-pubblicati, pubblicati-esauriti (vendite perse).',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'pnl_summary', description: 'Conto Economico Amimì per mese (netto, MC1, MC2) del 2026.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'ads_summary', description: 'Meta Ads per mese: spesa, acquisti, valore, ROAS.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'ask_data', description: 'Domanda in linguaggio naturale sui dati (NL->SQL via Gemini, sola lettura).',
    inputSchema: { type: 'object', properties: { domanda: { type: 'string' } }, required: ['domanda'] } },
  { name: 'propose_expense', description: 'Propone una spesa (va in approvazione). costo positivo, categoria tra COGS/LOGISTICA/MARKETING/OPEX/PACKAGING/SALARI/TASSE.',
    inputSchema: { type: 'object', properties: { operazione: { type: 'string' }, costo: { type: 'number' }, categoria: { type: 'string' }, amimi: { type: 'boolean' }, data: { type: 'string' } }, required: ['operazione', 'costo', 'categoria'] } },
  { name: 'register_count', description: 'Registra una conta fisica per un CODICE.',
    inputSchema: { type: 'object', properties: { codice: { type: 'string' }, contati: { type: 'number' }, nota: { type: 'string' } }, required: ['codice', 'contati'] } },
];

async function writeApi(action: string, payload: Record<string, unknown>, chi: string) {
  const r = await fetch(`${SB_URL}/functions/v1/write-api`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, pin: 'x', chi }),
  });
  return r.json();
}

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'list_inventory': {
      let q = sb.from('v_inventory').select('codice,item,variant,giacenza_attuale,disponibili_da_vendere,on_shopify,valore').order('giacenza_attuale');
      const f = args.filtro;
      if (f === 'da_riordinare') q = q.lte('giacenza_attuale', 3);
      else if (f === 'esauriti') q = q.lte('giacenza_attuale', 0);
      else if (f === 'su_shopify') q = q.eq('on_shopify', true);
      const { data } = await q.limit(Number(args.limit) || 50);
      let rows = data ?? [];
      if (args.cerca) { const s = String(args.cerca).toLowerCase(); rows = rows.filter((r: Record<string, unknown>) => `${r.item} ${r.variant} ${r.codice}`.toLowerCase().includes(s)); }
      return textResult(rows);
    }
    case 'what_to_reorder': {
      const { data } = await sb.from('v_reorder').select('codice,item,variant,giacenza,disponibili,venduto_60d,in_arrivo,giorni_stock').gt('venduto_60d', 0).order('venduto_60d', { ascending: false }).limit(Number(args.limit) || 25);
      return textResult(data ?? []);
    }
    case 'sku_availability': {
      const { data } = await sb.from('v_sku_availability').select('stato,codice,item,variant');
      const rows = data ?? [];
      const by = (s: string) => rows.filter((r: Record<string, unknown>) => r.stato === s);
      return textResult({ acquistabili: by('acquistabile').length, in_stock_non_pubblicati: by('in_stock_non_pubblicato'), pubblicati_esauriti: by('pubblicato_esaurito') });
    }
    case 'pnl_summary': {
      const { data } = await sb.from('v_ce_amimi_summary').select('month,omni_netto,mc1,mc2').eq('year', 2026).order('month');
      return textResult(data ?? []);
    }
    case 'ads_summary': {
      const { data } = await sb.from('v_ads_mensile').select('month,spend,purchases,purchase_value,roas').eq('year', 2026).order('month');
      return textResult(data ?? []);
    }
    case 'ask_data': {
      const r = await fetch(`${SB_URL}/functions/v1/ask-data`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: String(args.domanda || ''), pin: 'x' }) });
      return textResult(await r.json());
    }
    case 'propose_expense':
      return textResult(await writeApi('expense_propose', { operazione: args.operazione, costo: args.costo, categoria: args.categoria, amimi: args.amimi === false ? 'no' : 'si', date_paid: args.data }, 'Claude-MCP'));
    case 'register_count':
      return textResult(await writeApi('count', { codice: args.codice, contati: args.contati, nota: args.nota ?? 'via Claude MCP' }, 'Claude-MCP'));
    default:
      return { ...textResult('Tool sconosciuto: ' + name), isError: true };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...cors, 'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version' } });
  if (req.method === 'GET') return new Response('event: ping\ndata: {}\n\n', { headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });

  // Streamable HTTP: claude.ai sends Accept: text/event-stream and expects the response as an SSE
  // event. Honor that; fall back to plain JSON (so curl tests still work).
  const wantSSE = (req.headers.get('accept') || '').includes('text/event-stream');
  const respond = (b: unknown) => wantSSE
    ? new Response(`event: message\ndata: ${JSON.stringify(b)}\n\n`, { headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'mcp-session-id': 'amimi' } })
    : new Response(JSON.stringify(b), { headers: { ...cors, 'content-type': 'application/json', 'mcp-session-id': 'amimi' } });

  // Reads are open (data already public via the anon key); WRITES need the bearer token.
  const READ = new Set(['list_inventory', 'what_to_reorder', 'sku_availability', 'pnl_summary', 'ads_summary', 'ask_data']);
  const { data: flag } = await sb.from('app_flags').select('value').eq('key', 'mcp_token').single();
  const token = flag?.value;
  const authed = !!token && (req.headers.get('authorization') || '') === `Bearer ${token}`;

  let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try { msg = await req.json(); } catch { return respond(rpcErr(null, -32700, 'Parse error')); }
  const { id, method, params } = msg;

  if (method === 'initialize')
    return respond(rpc(id, { protocolVersion: (params?.protocolVersion as string) || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'amimi-app', version: '1.0.0' } }));
  if (typeof method === 'string' && method.startsWith('notifications/')) return new Response(null, { status: 202, headers: cors });
  if (method === 'ping') return respond(rpc(id, {}));
  if (method === 'tools/list') return respond(rpc(id, { tools: authed ? TOOLS : TOOLS.filter((t) => READ.has(t.name)) }));
  if (method === 'tools/call') {
    const name = String(params?.name || '');
    if (!TOOLS.some((t) => t.name === name)) return respond(rpcErr(id, -32602, 'Unknown tool: ' + name));
    if (!READ.has(name) && !authed) return respond(rpc(id, { ...textResult('Questa azione (scrittura) richiede il token MCP nel connettore (Authorization: Bearer <mcp_token>).'), isError: true }));
    try { return respond(rpc(id, await callTool(name, (params?.arguments as Record<string, unknown>) || {}))); }
    catch (e) { return respond(rpc(id, { ...textResult('Errore: ' + (e as Error).message), isError: true })); }
  }
  return respond(rpcErr(id, -32601, 'Method not found: ' + method));
});
