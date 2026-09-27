// Contatore del loop "100 pronti" (LOOP_100.md): quanti profili sono pronti, quanti mancano, la resa per fonte,
// e quanti account sono fermi in `enriched` (raccolti ma non ancora giudicati). Solo letture.
// Uso: node progress.mjs [--target 100] [--json]
// Exit code: 0 = target raggiunto, 3 = non ancora (cosi' il loop puo' leggerlo senza parsare).
import { supa } from './lib.mjs';
import { leggiStato } from './stato100.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const TARGET = Number(args.target || 100);
const sb = await supa();
const { accounts, stats, pronto, buono, ultimo } = await leggiStato(sb);

const conta = (f) => accounts.filter(f).length;
const r = {
  target: TARGET,
  pronti: conta(pronto),
  ab_senza_email: conta((a) => buono(a) && !pronto(a)),
  tier_A_pronti: conta((a) => pronto(a) && ultimo.get(a.id)?.tier_proposto === 'A'),
  enriched_da_giudicare: conta((a) => a.stato_ricerca === 'enriched'),
  seed_in_coda: conta((a) => a.stato_ricerca === 'seed'),
  resa_per_fonte: Object.fromEntries(Object.entries(stats).sort((x, y) => y[1].giudicati - x[1].giudicati).map(([k, v]) => [k, `${v.ab}/${v.giudicati}`])),
};
r.mancano = Math.max(0, TARGET - r.pronti);
if (args.json) console.log(JSON.stringify(r, null, 2));
else {
  console.log(`PRONTI ${r.pronti}/${TARGET} (di cui A ${r.tier_A_pronti}); mancano ${r.mancano}`);
  console.log(`A/B senza email: ${r.ab_senza_email} | enriched da giudicare: ${r.enriched_da_giudicare} | seed in coda: ${r.seed_in_coda}`);
  console.log('resa per fonte (A/B completi / giudicati):');
  for (const [k, v] of Object.entries(r.resa_per_fonte)) console.log(`  ${k}: ${v}`);
}
process.exit(r.mancano === 0 ? 0 : 3);
