// Filtra un file di id (giroN_ids.txt) tenendo solo gli account ancora in stato 'seed' (evita di ri-raccogliere i gia' giudicati).
// Uso: node out/solo_seed.mjs out/giro33_ids.txt [out/giro34_ids.txt ...] > out/giroX_ids.txt
import { readFileSync } from 'node:fs';
import { supa } from '../lib.mjs';
const ids = process.argv.slice(2).flatMap((f) => readFileSync(f, 'utf8').split(',').map((s) => s.trim()).filter(Boolean));
const sb = await supa();
const { data } = await sb.from('lead_accounts').select('id,stato_ricerca').in('id', ids);
const seed = new Set(data.filter((a) => a.stato_ricerca === 'seed').map((a) => a.id));
process.stdout.write(ids.filter((i) => seed.has(i)).join(','));
