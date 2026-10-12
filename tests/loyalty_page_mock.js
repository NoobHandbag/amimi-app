// tests/loyalty_page_mock.js: server finto per la pagina Area Membri (banco di prova locale, MAI in produzione).
// Lo inserisce tests/loyalty_page_harness.mjs dentro una copia della pagina: sostituisce fetch() per /apps/premia/*
// e risponde come loyalty-proxy v14, con uno scenario scelto da ?s=<nome>. Lo stato e' vivo: una coccola alza i punti,
// un riscatto li scala e aggiunge un codice. window.__calls tiene l'elenco delle chiamate fatte dalla pagina.
(function () {
  'use strict';
  var CDN = 'https://cdn.shopify.com/s/files/1/0952/1574/7399/files/';
  var FOTO = [
    ['LEA BAG COCCO BLUE', CDN + 'Lea_Bag_COCCO_BLUE-01-hero.jpg?v=1785248333'],
    ['LEA BAG BAMBI PONY', CDN + '20250611_4231__GM_a.jpg?v=1768485889'],
    ['NINA BAG CHECKS NAVY BLUE', CDN + '20250611_4239__GM.jpg?v=1768485895'],
    ['ANNIE BAG PAILLETTES', CDN + '20250326_0045__MOCCHETTI_AND_KRAUS.jpg?v=1768485943'],
    ['AGATA BAG EMBROIDERY', CDN + '20250326_0007__MOCCHETTI_AND_KRAUS.jpg?v=1768485922'],
    ['SOPHIE BAG SUEDE GREEN', CDN + '2026_09_01_AMIMI_BZ_0001.jpg?v=1788446555'],
  ];
  var AMICA12 = { key: 'amica12', label: 'Sconto Amica 12%', cost_points: 100, kind: 'percentage', value: 12, sort: 5 };
  var deck = function () { return FOTO.map(function (f) { return { img: f[1], titolo: f[0] }; }); };
  var borse = function (n) { var o = []; for (var i = 0; i < n; i++) o.push({ codice: 'COD_' + i, titolo: FOTO[i % 6][0] + (i > 5 ? ' MAXI EDIZIONE LIMITATA' : ''), img: i === 4 ? null : FOTO[i % 6][1], data: '2026-09-0' + ((i % 9) + 1), canale: 'online' }); return o; };
  var cod = function (code, day, used, key, val) { return { reward_key: key || 'amica12', cost_points: 100, status: 'fulfilled', discount_code: code, created_at: day + 'T10:00:00+00:00', kind: 'percentage', value: val || 12, used_at: used ? used + 'T09:30:00+00:00' : null }; };
  var tanti = function (n) { var o = []; for (var i = 0; i < n; i++) o.push(cod('AMICA12-T' + String(1000 + i), '2026-09-' + String(10 + (i % 18)), i % 3 === 0 ? '2026-10-0' + ((i % 8) + 1) : null)); return o; };
  var profOff = { profile_enabled: false, tier_lifetime_enabled: false, bonus_second_enabled: false, checkin_enabled: false, profile: null, birthday_today: false, birthday_awarded: false, punti_cumulati: 0, tier_cumulato: null, bonus_second: null };
  var base = function (points, over) {
    var s = { points: points, coccola: true, memory: true, wardrobe: borse(2), rewards: [AMICA12], redemptions: [], profile: profOff, deck: deck() };
    for (var k in (over || {})) s[k] = over[k];
    return s;
  };

  var SC = {
    // stati della pagina
    login:   { state: { state: 'login_required' } },
    spento:  { state: { state: 'off' } },
    errore:  { state: { error: 'read_failed' }, stateStatus: 503 },
    rete:    { network: true },
    firma:   { state: { error: 'stale_signature' }, stateStatus: 401 },
    // punti
    zero:    base(0, { wardrobe: [] }),
    p45:     base(45),
    p95:     base(95),
    p99:     base(99),
    p100:    base(100),
    p257:    base(257, { redemptions: [cod('AMICA12-KTQWJJ', '2026-10-09', null), cod('PREMIA-T20-6KQ4ZM', '2026-09-20', '2026-09-28', 'tessera', 20)] }),
    p980:    base(980, { redemptions: tanti(25), wardrobe: borse(9) }),
    // riscatto
    pending:        base(57, { redemptions: [{ reward_key: 'amica12', cost_points: 100, status: 'pending', discount_code: null, created_at: '2026-10-11T08:00:00+00:00', kind: 'percentage', value: 12, used_at: null }] }),
    riscatto_vuoto: base(230, { redeemMode: 'pending' }),
    riscatto_ko:    base(130, { redeemMode: 'error' }),
    riscatto_poco:  base(130, { redeemMode: 'insufficient' }),
    premi_off:      base(180, { rewardsOff: true }),
    premio_fisso:   base(120, { rewards: [{ key: 'omaggio', label: 'un portacarte in omaggio', cost_points: 100, kind: 'gift', value: null, sort: 1 }] }),
    // premio a IMPORTO (non a percentuale): la pagina non deve mai scrivere "10%"
    premio_importo: base(120, { rewards: [{ key: 'dieci', label: '10 euro di sconto', cost_points: 100, kind: 'amount', value: 10, sort: 1 }],
                                redemptions: [{ reward_key: 'dieci', cost_points: 100, status: 'fulfilled', discount_code: 'DIECI-ABC123', created_at: '2026-10-01T10:00:00+00:00', created_day: '2026-10-01', kind: 'amount', value: 10, used_at: null, used_day: null }] }),
    // risposta PERSA: il server scala i punti e consegna il codice, ma alla pagina arriva un 502 senza JSON.
    // Il "Riprova" deve rimandare lo stesso idemp e trovare il riscatto gia' fatto, senza scalare due volte.
    riscatto_perso: base(250, { redeemMode: 'lost' }),
    // gateway rotto: risposte non JSON che NON devono sembrare un profilo o un premio
    gateway:        { stateRaw: true },
    coccola_502:    base(250, { coccolaMode: 'raw502' }),
    memory_502:     base(250, { memoryMode: 'raw502' }),
    senza_saldo:    { state: { nanna: false, coccola_disponibile: true, memory_disponibile: true, wardrobe: [] } },
    // mezzanotte: un riscatto delle 00:30 di Roma e' del giorno 12, anche se in UTC e' ancora l'11
    mezzanotte:     base(40, { redemptions: [{ reward_key: 'amica12', cost_points: 100, status: 'fulfilled', discount_code: 'AMICA12-NOTTE1', created_at: '2026-10-11T22:30:00+00:00', created_day: '2026-10-12', kind: 'percentage', value: 12, used_at: '2026-10-12T22:40:00+00:00', used_day: '2026-10-13' }] }),
    // azioni del giorno
    fatti:        base(60, { coccola: false, memory: false }),
    // Mimi' parla: coccola gia' fatta (cosi' il tocco cambia frase invece di fare la coccola) con un premio pronto
    mimi_pronto:  base(130, { coccola: false }),
    mimi_due:     base(257, { coccola: false }),
    mimi_premio:  base(120, { coccola: false, rewards: [{ key: 'omaggio', label: 'un portacarte in omaggio', cost_points: 100, kind: 'gift', value: null, sort: 1 }] }),
    coccola_gia:  base(60, { coccolaMode: 'done' }),
    coccola_ko:   base(60, { coccolaMode: 'error' }),
    memory_gia:   base(60, { memoryMode: 'done' }),
    deck_ko:      base(60, { deckMode: 'error' }),
    deck_rotto:   base(60, { deck: [{ img: 'https://cdn.shopify.com/s/files/non-esiste-1.jpg', titolo: 'x' }, { img: 'https://cdn.shopify.com/s/files/non-esiste-2.jpg', titolo: 'y' }] }),
    // borse
    borse_null:   base(60, { wardrobe: null }),
    borse_tante:  base(60, { wardrobe: borse(9) }),
    // profilo, compleanno, seconda borsa, eventi (flag accesi)
    profilo:      base(60, { profile: { profile_enabled: true, tier_lifetime_enabled: false, bonus_second_enabled: true, checkin_enabled: true, profile: { complete: false, birth_locked: false, consenso_compleanno: false }, birthday_today: false, birthday_awarded: false, punti_cumulati: 60, tier_cumulato: 'amica', bonus_second: { awarded: false, ordini: 1, deadline: '2026-12-20', days_left: 70 } } }),
    profilo_ok:   base(160, { profile: { profile_enabled: true, tier_lifetime_enabled: true, bonus_second_enabled: true, checkin_enabled: true, profile: { complete: true, birth_day: 11, birth_month: 10, materiale_preferito: 'cocco', consenso_compleanno: true, birth_locked: true }, birthday_today: true, birthday_awarded: true, punti_cumulati: 460, tier_cumulato: 'cuore', bonus_second: { awarded: true } } }),
    // evento dal QR (aggiungere &evento=GALLIANO22 all'indirizzo)
    evento_ok:      base(45, { checkin: { ok: true, already: false, added: 20, label: 'Amimì da Galliano' } }),
    evento_gia:     base(65, { checkin: { ok: true, already: true, added: 0, label: 'Amimì da Galliano' } }),
    evento_presto:  base(45, { checkin: { ok: false, reason: 'not_started', label: 'Amimì da Galliano' } }),
    evento_finito:  base(45, { checkin: { ok: false, reason: 'ended', label: 'Amimì da Galliano' } }),
    evento_pieno:   base(45, { checkin: { ok: false, reason: 'full', label: 'Amimì da Galliano' } }),
    evento_ignoto:  base(45, { checkin: { ok: false, reason: 'unknown_event', label: null } }),
    evento_spento:  base(45, { checkin: { state: 'off' } }),
    evento_ko:      base(45, { checkin: { error: 'write_failed' }, checkinStatus: 500 }),
    // testo ostile in ogni campo che la pagina scrive con innerHTML: non deve nascere nessun elemento
    xss:            base(257, { wardrobe: [{ codice: 'X', titolo: '<img src=x onerror="window.__xss=1">', img: 'javascript:void(window.__xss=5)', data: '2026-09-01', canale: 'online' }],
                                rewards: [{ key: 'amica12"><b id="xk">', label: '<img src=x onerror="window.__xss=2">', cost_points: 100, kind: 'percentage', value: '12<i id="xv">', sort: 5 }],
                                redemptions: [cod('<img src=x onerror="window.__xss=3">', '2026-10-09', null)],
                                checkin: { ok: false, reason: 'ended', label: '<img src=x onerror="window.__xss=4">' } }),
    // server vecchio (v13): niente used_at/value nei riscatti, niente deck/checkin, profile senza checkin_enabled
    server_v13:     base(257, { old: true, redemptions: [{ reward_key: 'amica12', cost_points: 100, status: 'fulfilled', discount_code: 'AMICA12-KTQWJJ', created_at: '2026-10-09T10:00:00+00:00' }] }),
  };

  var qs = new URLSearchParams(location.search);
  // ?raf=timer: fotogrammi a orologio (16 ms), cosi' la camminata si prova davvero anche quando il browser non disegna;
  // ?raf=fermo: i fotogrammi non arrivano mai (scheda in secondo piano): resta solo l'arrivo garantito dai timer.
  if (qs.get('raf') === 'timer') { window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); }; window.cancelAnimationFrame = function (id) { clearTimeout(id); }; }
  if (qs.get('raf') === 'fermo') { window.requestAnimationFrame = function () { return 0; }; window.cancelAnimationFrame = function () {}; }
  var name = qs.get('s') || 'p257';
  var db = JSON.parse(JSON.stringify(SC[name] || SC.p257));
  var real = window.fetch;
  window.__calls = [];
  window.__errs = [];                                           // errori JS della pagina: le prove li vogliono a zero
  window.addEventListener('error', function (e) { if (e && e.message) window.__errs.push(String(e.message)); });
  window.addEventListener('unhandledrejection', function (e) { window.__errs.push('promessa rifiutata: ' + String((e.reason && e.reason.message) || e.reason)); });
  window.__mock = { name: name, db: db, scenari: Object.keys(SC) };

  function reply(data, status) { return { data: data, status: status || 200 }; }
  var RAW502 = { raw: '<html><body><h1>502 Bad Gateway</h1></body></html>', status: 502 };   // corpo non JSON, come un gateway rotto
  var fatti = {};                                                // idemp -> riscatto gia' eseguito (come il ramo already del server)
  function handle(action, body) {
    if (db.stateRaw && (action === 'state' || action === 'rewards' || action === 'profile')) return RAW502;
    if (db.state && (action === 'state' || action === 'rewards' || action === 'profile')) return reply(db.state, db.stateStatus || 200);
    if (action === 'state') return reply({ points: db.points, nanna: false, coccola_disponibile: db.coccola, memory_disponibile: db.memory, worn: null, wardrobe: db.wardrobe, wardrobe_source: 'db' });
    if (action === 'rewards') return db.rewardsOff ? reply({ state: 'off' }) : reply({ points: db.points, rewards: db.rewards, redemptions: db.redemptions });
    if (action === 'profile') { var p = JSON.parse(JSON.stringify(db.profile)); if (db.old) delete p.checkin_enabled; return reply(p); }
    if (action === 'coccola') {
      if (db.coccolaMode === 'error') return reply({ error: 'write_failed' }, 500);
      if (db.coccolaMode === 'raw502') return RAW502;
      if (db.coccolaMode === 'done' || !db.coccola) return reply({ done_today: true, points: db.points });
      db.points += 5; db.coccola = false; return reply({ points: db.points, added: 5 });
    }
    if (action === 'memory_win') {
      if (db.memoryMode === 'raw502') return RAW502;
      if (db.memoryMode === 'done' || !db.memory) return reply({ done_today: true, points: db.points });
      db.points += 5; db.memory = false; return reply({ points: db.points, added: 5 });
    }
    if (action === 'deck') {
      if (db.old) return reply({ error: 'unknown_action', action: 'deck' }, 422);
      if (db.deckMode === 'error') return reply({ error: 'read_failed' }, 503);
      return reply({ cards: db.deck });
    }
    if (action === 'redeem') {
      if (db.redeemMode === 'error') return reply({ error: 'redeem_failed' }, 500);
      if (db.redeemMode === 'insufficient') return reply({ ok: false, reason: 'insufficient', points: db.points }, 409);
      var idemp = body && body.idemp;
      if (idemp && fatti[idemp]) return reply({ ok: true, already: true, status: 'fulfilled', code: fatti[idemp], points: db.points });   // stesso token: nessun secondo addebito
      var rw = db.rewards[0]; db.points -= rw.cost_points;
      if (db.redeemMode === 'pending') { db.redemptions.unshift({ reward_key: rw.key, cost_points: rw.cost_points, status: 'pending', discount_code: null, created_at: new Date().toISOString(), kind: rw.kind, value: rw.value, used_at: null }); return reply({ ok: true, status: 'pending', code: null, points: db.points, cost: rw.cost_points }); }
      var code = 'AMICA12-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      db.redemptions.unshift({ reward_key: rw.key, cost_points: rw.cost_points, status: 'fulfilled', discount_code: code, created_at: new Date().toISOString(), kind: rw.kind, value: rw.value, used_at: null });
      if (idemp) fatti[idemp] = code;
      if (db.redeemMode === 'lost') { db.redeemMode = ''; return RAW502; }   // fatto a DB, risposta persa
      return reply({ ok: true, status: 'fulfilled', code: code, points: db.points, cost: rw.cost_points });
    }
    if (action === 'checkin') {
      if (db.old) return reply({ error: 'unknown_action', action: 'checkin' }, 422);
      var c = JSON.parse(JSON.stringify(db.checkin || { ok: false, reason: 'unknown_event', label: null }));
      if (c.ok && !c.already) { db.points += c.added; c.points = db.points; db.checkin = { ok: true, already: true, added: 0, label: c.label }; }
      else if (c.ok) c.points = db.points;
      return reply(c, db.checkinStatus || 200);
    }
    if (action === 'profile_save') {
      var pr = db.profile.profile; var first = !pr.complete && body && body.birth_day && body.birth_month && body.materiale;
      if (body && body.birth_day) { pr.birth_day = body.birth_day; pr.birth_month = body.birth_month; pr.birth_locked = true; }
      if (body && body.materiale) pr.materiale_preferito = body.materiale;
      pr.consenso_compleanno = !!(body && body.consenso);
      if (first) { pr.complete = true; db.points += 10; }
      return reply({ ok: true, awarded: !!first, added: first ? 10 : 0, points: db.points, birthday_locked: !!pr.birth_locked });
    }
    if (action === 'track') return reply({ ok: true, inserted: (body && body.events ? body.events.length : 0), capped: false });
    return reply({ error: 'unknown_action', action: action }, 422);
  }

  window.fetch = function (url, init) {
    if (typeof url === 'string' && url.indexOf('/apps/premia/') === 0) {
      var action = url.split('/').pop().split('?')[0];
      var body = null; try { body = init && init.body ? JSON.parse(init.body) : null; } catch (_) { body = null; }
      window.__calls.push({ action: action, method: (init && init.method) || 'GET', body: body });
      if (db.network) return Promise.reject(new TypeError('rete assente (finta)'));
      var r = handle(action, body);
      return new Promise(function (res) {
        setTimeout(function () {
          if (r.raw !== undefined) res(new Response(r.raw, { status: r.status, headers: { 'Content-Type': 'text/html' } }));
          else res(new Response(JSON.stringify(r.data), { status: r.status, headers: { 'Content-Type': 'application/json' } }));
        }, Number(qs.get('lento')) || 40);
      });
    }
    return real.apply(this, arguments);
  };
})();
