// Scelta manuale (28-09) dei residui delle shortlist nelle grandi citta' (prefissi di id da out/residui.mjs), round-robin per citta'.
// Uso: node out/pick_residui.cjs <lista 1..5> <numero giro>
const fs = require('fs');
const L = ['shortlist_italia2.json', 'shortlist_italia.json', 'shortlist_citta.json'].flatMap((f) => JSON.parse(fs.readFileSync('out/' + f)));
const perCitta = {
  Roma: ['49db7aa3', '6f1dde11', 'fa6f4dde', '9c69ed46', '8baa987d'],
  Napoli: ['45974c23', '565a7aa0', '8189954f', 'ac38d597', '64e726a4', '607f7980', '72e6ea2b', 'bf3c66ed', 'fc8b7c23', '445a3c39'],
  Torino: ['3f384914', 'c4f5b85e', 'ed0f001a', '7d1862a1', 'f0af052b', 'ef09635b', '27965e56', 'd22c608b'],
  Firenze: ['9ae81ba1', '3644db46', '7bb6c08a', '3fbdb812', 'c5789c94', '887e8ce0'],
  Bologna: ['b68031c5', '10a85fb6', 'e092dba8', '3aeb02a4', '8f49e5ef', 'b6a403a7', '81689c53', '32f6e91d', 'bb93e030'],
  Palermo: ['7e2f6867', '46c645d8', '894d9883', '3199fcf6', '5aa63eee', '84b97b55'],
  Genova: ['d8a5736b', '09e7b0e4', 'c6347e46', '28e98f3b', '4a94bc4d', 'b533cabd'],
  Bari: ['3a3fef8e', '2dcb0f38', '8e3c9ec9', 'a5ed5dec', '3fa73e29', '5ec37ef8', 'ae3d13cd', '54512e1d', '208c14eb', 'df61aeab', '0d44a208', 'e340b47b', '9c5381c5'],
  Venezia: ['db4b21a6', 'eb8d5c53', '26126189', 'f1d24470', '336d0ca3', 'a36be242', '5b43ce94'],
  Verona: ['d5524ba5', '9cf57572', 'fae1456d', '8d828428', '843aeafc', 'bd788c72'],
  Catania: ['b7ee8d11', '4b468d7f', 'b0cec2ff', '1d2dacbc', '737d35d8', 'f0305aa7', '6080c357', '4bc21301'],
};
const full = (p) => L.find((a) => a.id.startsWith(p));
const scelti = []; let more = true;
for (let r = 0; more; r++) { more = false; for (const c in perCitta) if (perCitta[c][r]) { scelti.push(full(perCitta[c][r])); more = true; } }
const n = Number(process.argv[2]);
const P = scelti.slice((n - 1) * 20, n * 20);
console.log(scelti.length, P.map((a) => `${a.nome} [${a.citta}]`).join(' | '));
fs.writeFileSync(`out/giro${process.argv[3]}_ids.txt`, P.map((a) => a.id).join(','));
