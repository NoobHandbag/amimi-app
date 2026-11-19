// tests/cs_chat_decisioni.mjs (nel glob tests/cs_*.mjs della CI): le decisioni di Dan del 19 novembre 2026 sulla chat
// del sito e sulle bozze email di Assistenza (migr 0199; file per il team TESTI_chat_sito_da_approvare_2026-11-13.md,
// P1, P5 e P8). Nessuna rete, nessun DB.
//   node tests/cs_chat_decisioni.mjs
// Tre parti:
//   1. cosa tocca la 0199: solo cs_knowledge 2 e 6 e cs_faq 3, 9, 41, 42, 49, una UPDATE difensiva per riga, guardie finali
//      e tetto dei 6.000 caratteri di cs-assist;
//   2. i fatti: gli orari della portineria sono quelli della voce 2 della chat (0195) in ogni riga del ritiro, i saldi non
//      sono piu' esclusi dai resi, le voci 5, 6 e 13 della chat non chiedono piu' nome ed email, la frase sui pre-ordini resta;
//   3. le guardie finali della migrazione scattano sui testi vecchi e tacciono sui nuovi (autocontrollo).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 300) : '')); } };

const M = read('supabase/migrations/0199_cs_ritiro_orari_saldi.sql');
const M0195 = read('supabase/migrations/0195_chat_testi_bottoni.sql');
const corpo = M.replace(/--.*$/gm, '');
const sql = (s) => "'" + s.replace(/'/g, "''") + "'";

// le coppie (vecchio -> nuovo) decise il 19-11, scritte qui per esteso: la migrazione deve contenerle alla lettera
const ORARI_IT = ['8:00-13:00', '14:00-17:00', '8:00-11:00'];
const COPPIE = [
  { r: 'k2', vecchio: "; articoli in saldo o comprati durante promozioni speciali: NIENTE cambi ne' resi. DIFETTI:", nuovo: '. DIFETTI:' },
  { r: 'k2', vecchio: 'RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano (non per pre-ordini o personalizzati).',
    nuovo: 'RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano, in portineria, lun-ven 8:00-13:00 e 14:00-17:00, sabato 8:00-11:00 (non per pre-ordini o personalizzati).', orari: true },
  { r: 'k2', vecchio: 'RIPARAZIONI E RESI SPEDITI: Via Santa Maria Fulcorina 13, 20123 Milano; niente orari fissi: si concorda la fascia col cliente, mai inventare orari.',
    nuovo: 'RIPARAZIONI E RESI SPEDITI: Via Santa Maria Fulcorina 13, 20123 Milano. Gli unici orari della portineria sono quelli del ritiro: mai inventarne altri.' },
  { r: 'k6', vecchio: 'Ordini online: ritiro in Via Santa Maria Fulcorina 13, 20123 Milano. Showroom e prove borse: Via Plinio 43, 20129 Milano su appuntamento. Concorda giorno e fascia oraria col cliente: NON esistono orari pubblicati, mai inventarli.',
    nuovo: "Ordini online: ritiro in Via Santa Maria Fulcorina 13, 20123 Milano, in portineria, dal lunedi' al venerdi' 8:00-13:00 e 14:00-17:00, il sabato 8:00-11:00: sono gli unici orari, mai inventarne altri. Showroom e prove borse: Via Plinio 43, 20129 Milano su appuntamento.", orari: true },
  { r: 'f9 it', vecchio: "Fammi sapere che giorno e in quale fascia oraria preferisci passare, cosi' ci organizziamo.",
    nuovo: "Puoi passare in portineria dal lunedi' al venerdi' 8:00-13:00 e 14:00-17:00, il sabato 8:00-11:00.", orari: true },
  { r: 'f9 en', vecchio: 'Let me know which day and time slot works best for you so we can arrange it.',
    nuovo: "You can collect it from the building's concierge (portineria), Monday to Friday 8:00-13:00 and 14:00-17:00, Saturday 8:00-11:00.", orari: true },
  { r: 'f3 it', vecchio: "Fammi sapere che giorno e in che fascia oraria pensi di venire, cosi' ti prepariamo tutto.",
    nuovo: "Il ritiro e' in portineria, dal lunedi' al venerdi' 8:00-13:00 e 14:00-17:00, il sabato 8:00-11:00.", orari: true },
  { r: 'f41 it', vecchio: "oppure lascia in chat nome, email e numero d'ordine (lo trovi nell'email di conferma dell'ordine). Il team ti risponde via email appena possibile.",
    nuovo: "oppure scrivi qui il numero d'ordine (lo trovi nell'email di conferma dell'ordine): il team ti risponde via email appena possibile.", chat: true },
  { r: 'f41 en', vecchio: 'or leave your name, email and order number in the chat (you will find it in the order confirmation email). Our team will reply by email as soon as possible.',
    nuovo: 'or write your order number here (you will find it in the order confirmation email): our team will reply by email as soon as possible.', chat: true },
  { r: 'f42 it', vecchio: 'oppure lascialo in chat con nome ed email:', nuovo: 'oppure scrivilo qui:', chat: true },
  { r: 'f42 en', vecchio: 'or leave it in the chat with your name and email:', nuovo: 'or write it here:', chat: true },
  { r: 'f49 it', vecchio: 'oppure lascia in chat nome, email e domanda:', nuovo: 'oppure scrivi qui la tua domanda:', chat: true },
  { r: 'f49 en', vecchio: 'or leave your name, email and question in the chat:', nuovo: 'or write your question here:', chat: true },
];

// ---- parte 1: cosa tocca ----
console.log('\n== migrazione 0199: cosa tocca ==');
const scritture = [...corpo.matchAll(/\b(insert into|update|delete from|alter table|create|drop)\s+([a-z_.]+)/gi)].map((m) => m[1].toLowerCase() + ' ' + m[2]);
t('T1 solo UPDATE su cs_knowledge e cs_faq (niente insert, delete, DDL, app_flags)', scritture.length > 0 && scritture.every((s) => s === 'update cs_knowledge' || s === 'update cs_faq'), scritture);
const idK = [...corpo.matchAll(/update cs_knowledge[\s\S]*?where id = (\d+);/g)].map((m) => +m[1]);
const idF = [...corpo.matchAll(/update cs_faq[\s\S]*?where id = (\d+);/g)].map((m) => +m[1]);
t('T2 righe: cs_knowledge 2 e 6, cs_faq 9 e 3 (ritiro) e 41, 42, 49 (P5), una UPDATE ciascuna', JSON.stringify(idK) === '[2,6]' && JSON.stringify(idF) === '[9,3,41,42,49]', { idK, idF });
const guardie = [...corpo.matchAll(/raise exception '(cs_knowledge|cs_faq) id (\d+): testo atteso non trovato/g)].map((m) => m[1].slice(3, 4) + m[2]);
t('T3 ogni UPDATE ha prima la sua guardia "testo atteso non trovato" (riga cambiata a mano = stop, non sovrascrive)', JSON.stringify(guardie) === '["k2","k6","f9","f3","f41","f42","f49"]', guardie);
t('T4 un blocco solo, con le guardie finali e il tetto dei 6.000 caratteri della 0174', (corpo.match(/^do \$\$/gm) ?? []).length === 1 && /end \$\$;\s*$/.test(corpo)
  && /restano % righe cs_\* attive con orari da concordare o saldi esclusi dai resi/.test(corpo) && /restano % voci della chat che chiedono nome ed email/.test(corpo)
  && /if peggiore > 6000 then/.test(corpo) && /regexp_matches\(r\.s, '\[\\U00010000-\\U0010FFFF\]', 'g'\)/.test(corpo));
t('T5 le righe P5 sono solo voci della chat (tipo risposta_chat), A3 una risposta standard, la riga 3 un esempio di tono',
  [41, 42, 49].every((id) => new RegExp(`where id = ${id} and tipo = 'risposta_chat'`).test(corpo)) && /where id = 9 and tipo = 'risposta_standard'/.test(corpo) && /where id = 3 and tipo = 'esempio_tono'/.test(corpo));
const mancanti = COPPIE.filter((c) => !corpo.includes(sql(c.vecchio)) || !corpo.includes(sql(c.nuovo))).map((c) => c.r);
t('T6 ogni frase vecchia e nuova decisa il 19-11 e\' nella migrazione alla lettera', mancanti.length === 0, mancanti);

// ---- parte 2: i fatti ----
console.log('\n== i fatti ==');
const voce2 = (M0195.match(/\('risposta_chat', 'faq-ritiro-di-persona:(?:[^']|'')*', (?:null|'(?:[^']|'')*'),\s*\$t\$([\s\S]*?)\$t\$,\s*\$t\$([\s\S]*?)\$t\$/) ?? ['', '', '']);
t('F1 gli orari sono quelli della voce 2 della chat (0195), in italiano e in inglese', ORARI_IT.every((o) => voce2[1].includes(o) && voce2[2].includes(o)), voce2[1]);
t('F2 ogni riga nuova del ritiro porta i tre orari e la portineria', COPPIE.filter((c) => c.orari).every((c) => ORARI_IT.every((o) => c.nuovo.includes(o)) && /portineria/.test(c.nuovo)));
const vietateRitiro = /fascia|time slot|concorda|orari pubblicati|niente orari fissi|which day/i;
t('F3 nessuna riga nuova chiede giorno o fascia, ne\' dice che non ci sono orari', COPPIE.every((c) => !vietateRitiro.test(c.nuovo)), COPPIE.filter((c) => vietateRitiro.test(c.nuovo)).map((c) => c.r));
t('F4 saldi: la riga 2 nuova non esclude piu\' saldi e promozioni dai resi', !/saldo|promozioni speciali|NIENTE cambi/i.test(COPPIE.filter((c) => c.r === 'k2').map((c) => c.nuovo).join(' ')));
t('F5 la frase sui pre-ordini e il su misura della riga 2 resta com\'e\' (domanda ancora aperta per il team)', COPPIE[1].nuovo.endsWith('(non per pre-ordini o personalizzati).'));
const p5 = COPPIE.filter((c) => c.chat);
t('F6 P5: le voci 5, 6 e 13 non chiedono piu\' nome ed email, dicono "qui" / "here"', p5.every((c) => !/nome|email e|name|and email/i.test(c.nuovo.replace(/email di conferma|confirmation email|via email|by email/g, '')) && /\bqui\b|\bhere\b/.test(c.nuovo)), p5.map((c) => c.nuovo));
t('F7 niente segnaposto, link o telefono nelle frasi nuove della chat; marchio e indirizzi invariati', p5.every((c) => !/[{}\[\]]|https?:|www\.|\+39/.test(c.nuovo)));

// ---- parte 3: autocontrollo delle guardie finali ----
console.log('\n== guardie finali: scattano sui testi vecchi, tacciono sui nuovi ==');
const reOrari = new RegExp((corpo.match(/s\.t ~\* '([^']+)'/) ?? ['', '$^'])[1], 'i');
const reNome = new RegExp((corpo.match(/~\* '(\(in chat nome[^']+)'/) ?? ['', '$^'])[1], 'i');
const ritiroSaldi = COPPIE.filter((c) => !c.chat);
t('G1 la guardia "orari da concordare o saldi esclusi" vede ogni frase vecchia del ritiro e dei saldi',
  ritiroSaldi.filter((c) => c.vecchio !== COPPIE[1].vecchio).every((c) => reOrari.test(c.vecchio)), ritiroSaldi.filter((c) => !reOrari.test(c.vecchio)).map((c) => c.r));
t('G2 e non vede nessuna frase nuova', COPPIE.every((c) => !reOrari.test(c.nuovo)));
t('G3 la guardia "nome ed email" vede le tre voci vecchie della chat in italiano e inglese e nessuna nuova',
  p5.every((c) => reNome.test(c.vecchio) && !reNome.test(c.nuovo)), p5.filter((c) => !reNome.test(c.vecchio)).map((c) => c.r));

console.log(`\ncs_chat_decisioni: ${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
