// Sceglie il prossimo lotto di seed per il loop "100 pronti" (LOOP_100.md) secondo priority.mjs e, con --collect,
// lancia il collector solo su quegli id. Senza --collect stampa il lotto e basta (nessuna scrittura).
// Si ferma PRIMA di scegliere se ci sono account `enriched` non ancora giudicati: il giudizio del lotto
// precedente va chiuso prima di raccoglierne un altro (altrimenti judge_digest mescola i lotti).
// Uso: node next_batch.mjs [--n 20] [--tetto-citta 5] [--fonte "maps:concept store"] [--collect]
// Triage: `--n 40` senza --collect, la sessione mette i nomi palesemente fuori target in out/triage_skip.json,
// poi `node collect.mjs --ids <i 20 scelti>`.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { supa } from './lib.mjs';
import { leggiStato } from './stato100.mjs';
import { scegliLotto, resaFonte } from './priority.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const N = Number(args.n || 20);
const TETTO = Number(args['tetto-citta'] || 5);
const sb = await supa();
const { accounts, stats, tentati } = await leggiStato(sb);

const pendenti = accounts.filter((a) => a.stato_ricerca === 'enriched');
if (pendenti.length) {
  console.log(`STOP: ${pendenti.length} account in enriched non ancora giudicati. Chiudi prima il giudizio (judge_digest -> judge_write).`);
  process.exit(2);
}
// triage per nome della sessione (out/triage_skip.json: [{id, nome, motivo}]): saltati, restano seed nel DB
const SKIP = existsSync('out/triage_skip.json') ? new Set(JSON.parse(readFileSync('out/triage_skip.json', 'utf8')).map((x) => x.id)) : new Set();
let seeds = accounts.filter((a) => a.stato_ricerca === 'seed' && !tentati.has(a.id) && !SKIP.has(a.id));
if (args.fonte) seeds = seeds.filter((a) => a.fonte_seed === args.fonte);
if (!seeds.length) { console.log('Nessun seed in coda: serve un nuovo sweep (seed_maps.mjs).'); process.exit(4); }

const lotto = scegliLotto(seeds, stats, N, TETTO);
console.log(`Resa fonti usata: ${Object.keys(stats).map((k) => `${k}=${resaFonte(stats, k).toFixed(2)}`).join(', ')}`);
console.log(`Lotto di ${lotto.length} (su ${seeds.length} seed):`);
for (const a of lotto) console.log(`  ${a.priorita.toFixed(3)}  ${a.nome} [${a.citta}] ${a.fonte_seed}`);

mkdirSync('out', { recursive: true });
const file = `out/lotto_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify(lotto.map((a) => ({ id: a.id, nome: a.nome, citta: a.citta, fonte_seed: a.fonte_seed, priorita: a.priorita })), null, 2));
console.log(`Lotto salvato in ${file}`);

if (args.collect) {
  const r = spawnSync(process.execPath, ['collect.mjs', '--ids', lotto.map((a) => a.id).join(',')], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
