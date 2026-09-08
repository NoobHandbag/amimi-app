// Esporta in locale il materiale per il giudizio (stadio D): per ogni account `enriched` scrive
// out/judge/<slug>/evidence.json e scarica gli screenshot, cosi' la sessione Claude Code li legge
// e compila le valutazioni (poi caricate con judge_write.mjs).
// Uso: node judge_dump.mjs [--stato enriched|scored] [--id uuid]
import { mkdirSync, writeFileSync } from 'node:fs';
import { supa, BUCKET } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const sb = await supa();
let q = sb.from('lead_accounts').select('*').order('created_at');
if (args.id) q = q.eq('id', args.id); else q = q.eq('stato_ricerca', args.stato || 'enriched');
const { data: accounts, error } = await q; if (error) throw error;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const index = [];
for (const a of accounts) {
  const dir = `out/judge/${slug(a.nome)}`; mkdirSync(dir, { recursive: true });
  const { data: ev } = await sb.from('lead_evidence').select('*').eq('account_id', a.id).order('captured_at');
  // ultima evidenza per tipo (le vecchie restano nel json completo)
  const last = {}; for (const e of ev) last[e.tipo] = e;
  const shots = [];
  for (const e of Object.values(last)) {
    if (!e.asset_path) continue;
    const { data, error: de } = await sb.storage.from(BUCKET).download(e.asset_path);
    if (de) { console.log('  download err', e.asset_path, de.message); continue; }
    const f = `${dir}/${e.tipo}.png`; writeFileSync(f, Buffer.from(await data.arrayBuffer())); shots.push(f);
  }
  writeFileSync(`${dir}/evidence.json`, JSON.stringify({ account: a, ultime: last, tutte: ev }, null, 1));
  index.push({ id: a.id, nome: a.nome, citta: a.citta, tipo: a.tipo, dir, shots, evidenze: ev.length, tipi: Object.keys(last) });
  console.log(`${a.nome}: ${ev.length} evidenze, ${shots.length} screenshot -> ${dir}`);
}
writeFileSync('out/judge/_index.json', JSON.stringify(index, null, 1));
console.log(`dump: ${accounts.length} account`);
