import xlsx from 'xlsx';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const wb = xlsx.readFile(fileURLToPath(new URL('../fixtures/seed.xlsx', import.meta.url)), { cellDates: true });
const rows = n => xlsx.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, defval: null });
const S = v => (v == null ? '' : String(v).trim());
function dump(sheet) {
  const r = rows(sheet); const out = [];
  for (let i = 6; i < r.length; i++) {
    const a = r[i] || []; const sotto = a[4], voce = a[5];
    if (sotto == null && voce == null) continue;
    const months = []; for (let c = 6; c <= 17; c++) months.push(a[c]);
    out.push({ row: i, ivaFlag: a[2], categoria: S(a[3]), sotto: S(sotto), voce: S(voce), key: `${S(sotto)}|${S(voce)}`, months });
  }
  return out;
}
const oracle = { CE_AMIMI: dump('CE_AMIMI'), CE_TOTALE: dump('CE_TOTALE') };
writeFileSync(fileURLToPath(new URL('../fixtures/ce_oracle.json', import.meta.url)), JSON.stringify(oracle));
const KEYS = ['Online|Pezzi','Online|Fatturato Lordo','Online|Fatturato Netto','Offline|Pezzi','Offline|Fatturato Lordo','Offline|Fatturato Netto','B2B|Pezzi','B2B|Fatturato Lordo','B2B|Fatturato Netto','Omnichannel|Fatturato Netto','Variabili|COGS (Cost of goods sold)','Variabili|Packaging','Variabili|Commissioni sui pagamenti','Variabili|Logistica','Variabili|Resi','Variabili|Total','Omnichannel|Margine di Contribuzione_1','Fissi|SALARI','Fissi|TASSE','Fissi|LOGISTICA','Fissi|OPEX','Fissi|EVENTI','Fissi|MARKETING','Fissi|Total ','Omnichannel|Margine di Contribuzione_2'];
for (const s of ['CE_AMIMI', 'CE_TOTALE']) {
  console.log('== ' + s + ' ==  (Feb Mar Apr May)');
  for (const l of oracle[s]) if (KEYS.includes(l.key)) {
    const v = l.months.slice(1, 5).map(x => (typeof x === 'number' ? Math.round(x * 100) / 100 : x));
    console.log('  ' + l.key.padEnd(42) + JSON.stringify(v));
  }
}
