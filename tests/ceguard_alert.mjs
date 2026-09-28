// tests/ceguard_alert.mjs — la decisione della push ntfy e il check `ce_codici_doppi` di ce-guard, ritagliati DAL
// SORGENTE che va in produzione (blocchi PURE:ceguard-alert e PURE:ceguard-doppi). Nessuna rete, nessun DB.
//   node tests/ceguard_alert.mjs
//
// Perche' esiste. Il 27-09 `ce_giacenze_negative` era gia' ERROR (6) ed e' salito a 7 per una vendita su un codice
// doppione: la firma della push era fatta delle sole CHIAVI error, non e' cambiata, e l'owner non ha saputo nulla.
// Dalla v8 un codice negativo NUOVO manda la push col suo nome; un numero che scende non manda niente.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const s = readFileSync(`${ROOT}supabase/functions/ce-guard/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const cut = (name) => {
  const B = `// ==== PURE:${name} BEGIN ====`, E = `// ==== PURE:${name} END ====`;
  const a = s.indexOf(B), b = s.indexOf(E);
  if (a < 0 || b < 0) { console.error(`marcatori PURE:${name} non trovati in ce-guard`); process.exit(1); }
  return s.slice(a + B.length, b).trim();
};
const TMP = `${ROOT}tests/_ceguard_alert.tmp.ts`;
writeFileSync(TMP, `${cut('ceguard-alert')}\n${cut('ceguard-doppi')}\nexport { decidiAlert, messaggioAlert, leggiDetail, gruppiParoleInvertite };\n`, 'utf8');
let decidiAlert, messaggioAlert, leggiDetail, gruppiParoleInvertite;
try { ({ decidiAlert, messaggioAlert, leggiDetail, gruppiParoleInvertite } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra) : '')); } };

const SEI = ['AGATA_BAG_FLORAL_LIGHT_GREY', 'AGATA_BAG_ROSE_BUTTER_GREEN', 'AGATA_BAG_ROSE_PINK', 'ANNIE_BAG_BROWN_CHOCOLATE', 'LEA_BAG_BLACK_PIERCING', 'LEA_BAG_COCCO_PURPLE'];
const neg = (n) => ({ k: 'ce_giacenze_negative', label: `Prodotti con giacenza negativa (${n})`, n, severity: 'error' });
const rec = { k: 'ce_shopify_reconcile', label: 'Riconciliazione', n: 1, severity: 'error' };
const PREV = 'ce_giacenze_negative,ce_shopify_reconcile';

console.log('== il caso del 27-09: 6 -> 7 ==');
const sette = [...SEI, 'LEA_BAG_BAMBI_PONY'].sort();
const d1 = decidiAlert([neg(7), rec], PREV, { ce_giacenze_negative: sette }, { ce_giacenze_negative: SEI });
t('1  stesso insieme di chiavi ma un codice nuovo -> push', d1.push === true && d1.sig === PREV, d1);
t('2  il nuovo codice e\' quello giusto, e solo lui', JSON.stringify(d1.nuovi) === JSON.stringify({ ce_giacenze_negative: ['LEA_BAG_BAMBI_PONY'] }), d1.nuovi);
const m1 = messaggioAlert([neg(7), rec], d1.nuovi);
t('3  il testo della push nomina il codice nuovo', m1.includes('LEA_BAG_BAMBI_PONY') && m1.startsWith('NUOVI in ce_giacenze_negative'), m1);
t('4  e porta ancora tutte le righe error', m1.includes('- Prodotti con giacenza negativa (7)') && m1.includes('- Riconciliazione'));

console.log('\n== cosa NON deve notificare ==');
const d2 = decidiAlert([neg(5), rec], PREV, { ce_giacenze_negative: SEI.slice(1) }, { ce_giacenze_negative: SEI });
t('5  il numero scende (6 -> 5), stesse chiavi -> nessuna push', d2.push === false, d2);
const d3 = decidiAlert([neg(6), rec], PREV, { ce_giacenze_negative: SEI }, { ce_giacenze_negative: SEI });
t('6  tutto invariato -> nessuna push', d3.push === false);
const d4 = decidiAlert([neg(6), rec], PREV, { ce_giacenze_negative: SEI }, null);
t('7  primo giro dopo il deploy (elenco mai salvato): nessun codice "nuovo", nessuna push', d4.push === false && Object.keys(d4.nuovi).length === 0, d4);
const d5 = decidiAlert([rec], 'ce_shopify_reconcile', { ce_giacenze_negative: sette }, { ce_giacenze_negative: SEI });
t('8  un check non in ERROR non conta come peggiorato', d5.push === false && Object.keys(d5.nuovi).length === 0, d5);

console.log('\n== il comportamento v3 resta ==');
const d6 = decidiAlert([rec], PREV, { ce_giacenze_negative: [] }, { ce_giacenze_negative: SEI });
t('9  cambia l\'insieme delle chiavi (i negativi rientrano) -> push come prima', d6.push === true && d6.sig === 'ce_shopify_reconcile');
const d7 = decidiAlert([], PREV, { ce_giacenze_negative: [] }, { ce_giacenze_negative: SEI });
t('10 tutto verde -> push "tutto a posto", firma vuota', d7.push === true && d7.sig === '' && messaggioAlert([], d7.nuovi) === 'I problemi segnalati sono rientrati.');
const d8 = decidiAlert([neg(1)], '', { ce_giacenze_negative: ['X'] }, { ce_giacenze_negative: [] });
t('11 da verde a un negativo: push, e il codice e\' nel testo', d8.push && messaggioAlert([neg(1)], d8.nuovi).includes('X'));
const d9 = decidiAlert([neg(6), rec], PREV, { ce_giacenze_negative: [...SEI.slice(1), 'NUOVO'] }, { ce_giacenze_negative: SEI });
t('12 uno esce e uno entra (n resta 6) -> push col codice entrato', d9.push && d9.nuovi.ce_giacenze_negative?.[0] === 'NUOVO');

console.log('\n== lettura dello stato salvato ==');
t('13 JSON valido', JSON.stringify(leggiDetail('{"ce_giacenze_negative":["A","B"]}')) === '{"ce_giacenze_negative":["A","B"]}');
t('14 assente / vuoto / rotto / non oggetto -> null (primo giro)', [undefined, '', '{rotto', '[1,2]', 'null'].every((v) => leggiDetail(v) === null));

console.log('\n== ce_codici_doppi ==');
const g1 = gruppiParoleInvertite(['LEA_BAG_BAMBI_PONY', 'LEA_BAG_PONY_BAMBI', 'LEA_BAG_ZEBRA', 'LEA_BAG_ZEBRA_PONY']);
t('15 il caso Bambi e\' un gruppo, ZEBRA / ZEBRA_PONY no (parole diverse)', JSON.stringify(g1) === JSON.stringify([['LEA_BAG_BAMBI_PONY', 'LEA_BAG_PONY_BAMBI']]), g1);
t('16 case-insensitive e un codice ripetuto identico non fa gruppo', gruppiParoleInvertite(['Lea_Bag_Black', 'LEA_BAG_BLACK']).length === 0);
t('17 maiuscole diverse + parole invertite = gruppo', gruppiParoleInvertite(['annie_bag_silk_red', 'ANNIE_BAG_RED_SILK']).length === 1);
t('18 valori vuoti o null ignorati', gruppiParoleInvertite(['', null, undefined, 'A_B']).length === 0);

console.log('\n== il wiring nel sorgente ==');
t('19 la push usa decidiAlert e messaggioAlert', /decidiAlert\(errs, prev,/.test(s) && /messaggioAlert\(errs, dec\.nuovi\)/.test(s));
t('20 lo stato si aggiorna solo a push consegnata (res.ok)', /if \(res\.ok\) await sb\.from\('app_flags'\)\.upsert\(\[\{ key: 'ceguard_alert_state', value: dec\.sig \}, \.\.\.detailRow\]/.test(s));
t('21 lettura dello stato notifiche controllata (errore -> niente push)', /if \(lfErr\) throw new Error/.test(s));
t('22 elenco negativi solo da una lettura riuscita', /const alertDetail: AlertDetail \| null = inv \?/.test(s));
t('23 ce_codici_doppi e\' WARN', /add\('ce_codici_doppi',[\s\S]*?doppi\.length, 'warn'\)/.test(s));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
