'use strict';
/*
 * Mixue Sch - mesin penjadwalan (tanpa dependensi, jalan di browser & Node).
 *
 * Aturan yang diterapkan:
 *  - 5 orang, masing-masing libur 1x seminggu, hanya Senin-Jumat (Sabtu/Minggu dilarang libur).
 *    Karena Senin-Jumat tiap hari hanya boleh 1 orang libur, hari libur 5 orang = permutasi Sen-Jum.
 *  - Senin-Jumat : Pagi (Kasir + Piket), Siang (Kasir + Piket), 1 orang libur.
 *  - Sabtu-Minggu: Pagi (Kasir + Piket), Middle (1 orang), Siang (Kasir + Piket).
 *  - Middle Sabtu & Minggu orang yang sama, dirotasi tiap minggu.
 *  - Sabtu-Minggu: pasangan tetap sama, shift bergantian (Pagi<->Siang) dan tugas bergantian (Kasir<->Piket).
 *  - Sehari sebelum libur wajib Pagi (Kasir); sehari setelah libur wajib Siang (Kasir).
 *    Rolling antar minggu: Minggu kasir pagi = yang libur Senin depan.
 *    Libur Jumat -> Sabtu kasir siang, jadi Middle bukan orang yang libur Jumat.
 *  - Jatah per minggu: yang dapat Middle = 2x Pagi + 2x Siang (+ 2x Middle),
 *    yang tidak dapat Middle = 3x Pagi + 3x Siang.
 *  - Jarak libur antar minggu tidak boleh terlalu jauh / terlalu dekat
 *    (contoh: Senin -> Kamis/Jumat terlalu jauh, Jumat -> Senin terlalu dekat).
 *  - Request masuk shift: dipenuhi selama tidak melanggar aturan di atas.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scheduler = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const DAYS_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  const SLOT_LABEL = {
    PK: 'Pagi · Kasir', PP: 'Pagi · Piket', SK: 'Siang · Kasir',
    SP: 'Siang · Piket', M: 'Middle', L: 'Libur',
  };
  const DEFAULT_SETTINGS = { minGap: 4, maxGap: 9 };
  const SLOTS4 = ['PK', 'PP', 'SK', 'SP'];
  const N = 5;

  const isPagi = (c) => c === 'PK' || c === 'PP';
  const isSiang = (c) => c === 'SK' || c === 'SP';
  const isKasir = (c) => c === 'PK' || c === 'SK';
  const shiftOf = (c) => (isPagi(c) ? 'Pagi' : isSiang(c) ? 'Siang' : c === 'M' ? 'Middle' : 'Libur');
  const roleOf = (c) => (isKasir(c) ? 'Kasir' : c === 'PP' || c === 'SP' ? 'Piket' : '');

  function permutations(arr) {
    const res = [];
    (function rec(cur, rest) {
      if (!rest.length) { res.push(cur); return; }
      for (let i = 0; i < rest.length; i++) {
        rec(cur.concat(rest[i]), rest.slice(0, i).concat(rest.slice(i + 1)));
      }
    })([], arr);
    return res;
  }
  const PERMS4 = permutations([0, 1, 2, 3]);
  const PERMS5 = permutations([0, 1, 2, 3, 4]);

  /* ---------- pemeriksaan input libur ---------- */

  // off: array 5 nama/null (Senin..Jumat). Kembalikan {errors, complete, map}
  function checkOff(people, off) {
    const errors = [];
    const map = {};
    const seen = {};
    off.forEach((name, d) => {
      if (!name) return;
      if (people.indexOf(name) < 0) { errors.push('Nama tidak dikenal: ' + name); return; }
      if (seen[name] !== undefined) {
        errors.push(name + ' dipilih libur lebih dari sekali (' + DAYS[seen[name]] + ' & ' + DAYS[d] + ')');
      } else { seen[name] = d; map[name] = d; }
    });
    const complete = errors.length === 0 && Object.keys(map).length === N;
    return { errors, complete, map };
  }

  // Bandingkan hari libur minggu lalu vs minggu ini. gap = jarak hari antar libur.
  function gapIssues(prevMap, curMap, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const issues = [];
    Object.keys(curMap).forEach((name) => {
      if (prevMap[name] === undefined) return;
      const gap = 7 + (curMap[name] - prevMap[name]);
      if (gap > s.maxGap) {
        issues.push({ person: name, kind: 'jauh', gap, from: prevMap[name], to: curMap[name],
          text: name + ': libur ' + DAYS[prevMap[name]] + ' → ' + DAYS[curMap[name]] + ' (jarak ' + gap + ' hari, terlalu jauh)' });
      } else if (gap < s.minGap) {
        issues.push({ person: name, kind: 'dekat', gap, from: prevMap[name], to: curMap[name],
          text: name + ': libur ' + DAYS[prevMap[name]] + ' → ' + DAYS[curMap[name]] + ' (jarak ' + gap + ' hari, terlalu dekat)' });
      }
    });
    return issues;
  }

  /* ---------- solver satu minggu ---------- */

  function prepare(params) {
    const people = params.people;
    const idx = (name) => people.indexOf(name);
    const offIdx = params.off.map(idx);
    const offDay = [-1, -1, -1, -1, -1];
    offIdx.forEach((p, d) => { offDay[p] = d; });
    const nextMon = params.nextMondayOff ? idx(params.nextMondayOff) : -1;
    const forcedPK = [-1, -1, -1, -1, -1, -1, -1];
    const forcedSK = [-1, -1, -1, -1, -1, -1, -1];
    for (let d = 0; d <= 3; d++) forcedPK[d] = offIdx[d + 1];
    forcedPK[6] = nextMon;
    for (let d = 1; d <= 4; d++) forcedSK[d] = offIdx[d - 1];
    forcedSK[5] = offIdx[4];
    let prevSunday = null;
    if (params.prev && params.prev.sunday) {
      prevSunday = people.map((n) => params.prev.sunday[n] || null);
    }
    return { people, offIdx, offDay, nextMon, forcedPK, forcedSK, prevSunday };
  }

  function reqOk(codes, r) {
    const c = codes[r.p];
    if (r.shift === 'Pagi') return isPagi(c);
    if (r.shift === 'Siang') return isSiang(c);
    if (r.shift === 'Middle') return c === 'M';
    return true;
  }

  function optionOf(codes) {
    const pagi = [], siang = [];
    for (let p = 0; p < N; p++) {
      if (isPagi(codes[p])) pagi.push(p);
      else if (isSiang(codes[p])) siang.push(p);
    }
    return { codes, pagi, siang };
  }

  function buildDayOptions(ctx, M, reqs) {
    const out = [];
    for (let d = 0; d < 7; d++) {
      const W = [];
      for (let p = 0; p < N; p++) {
        if (d < 5 && ctx.offIdx[d] === p) continue;
        if (d >= 5 && p === M) continue;
        W.push(p);
      }
      const list = [];
      for (const perm of PERMS4) {
        const codes = new Array(N);
        if (d < 5) codes[ctx.offIdx[d]] = 'L'; else codes[M] = 'M';
        for (let i = 0; i < 4; i++) codes[W[i]] = SLOTS4[perm[i]];
        if (ctx.forcedPK[d] >= 0 && codes[ctx.forcedPK[d]] !== 'PK') continue;
        if (ctx.forcedSK[d] >= 0 && codes[ctx.forcedSK[d]] !== 'SK') continue;
        if (reqs.some((r) => r.d === d && !reqOk(codes, r))) continue;
        list.push(optionOf(codes));
      }
      out.push(list);
    }
    return out;
  }

  /*
   * Aturan Sabtu-Minggu: pasangan tetap sama, shift bergantian (Sabtu Pagi -> Minggu Siang dan sebaliknya),
   * dan tugas bergantian (Sabtu Kasir -> Minggu Piket dan sebaliknya).
   * Jadi Minggu = Sabtu dengan Pagi Kasir<->Siang Piket dan Pagi Piket<->Siang Kasir. Middle tetap.
   */
  const SWAP = { PK: 'SP', PP: 'SK', SK: 'PP', SP: 'PK', M: 'M' };
  function sundayFromSaturday(ctx, reqs, sat) {
    const codes = sat.codes.map((c) => SWAP[c]);
    if (ctx.forcedPK[6] >= 0 && codes[ctx.forcedPK[6]] !== 'PK') return null;
    if (reqs.some((r) => r.d === 6 && !reqOk(codes, r))) return null;
    return optionOf(codes);
  }

  function scoreSolution(ctx, chosen) {
    const kas = [0, 0, 0, 0, 0];
    let sc = 0;
    for (let d = 0; d < 7; d++) {
      for (let p = 0; p < N; p++) if (isKasir(chosen[d].codes[p])) kas[p]++;
    }
    sc += kas.reduce((a, k) => a + k * k, 0) * 10;
    for (let p = 0; p < N; p++) {
      for (let d = 0; d < 6; d++) {
        if (isSiang(chosen[d].codes[p]) && isPagi(chosen[d + 1].codes[p])) sc += 3;
      }
      if (ctx.prevSunday && isSiang(ctx.prevSunday[p]) && isPagi(chosen[0].codes[p])) sc += 3;
    }
    return sc;
  }

  // Cari susunan terbaik untuk 1 kandidat Middle. null jika tidak ada.
  function searchMiddle(ctx, M, reqs, firstOnly) {
    const opts = buildDayOptions(ctx, M, reqs);
    if (opts.slice(0, 6).some((l) => l.length === 0)) return null;
    const target = [0, 1, 2, 3, 4].map((p) => (p === M ? 2 : 3));
    const pg = [0, 0, 0, 0, 0];
    const sg = [0, 0, 0, 0, 0];
    const chosen = new Array(7);
    let best = null, bestScore = Infinity, nodes = 0;
    const LIMIT = 800000;
    let stop = false;
    // mulai dari akhir pekan (paling terikat aturan), lalu Senin..Jumat
    const order = [5, 0, 1, 2, 3, 4];

    function add(opt) {
      let ok = true;
      for (let i = 0; i < opt.pagi.length; i++) if (++pg[opt.pagi[i]] > target[opt.pagi[i]]) ok = false;
      for (let i = 0; i < opt.siang.length; i++) if (++sg[opt.siang[i]] > target[opt.siang[i]]) ok = false;
      return ok;
    }
    function undo(opt) {
      for (let i = 0; i < opt.pagi.length; i++) pg[opt.pagi[i]]--;
      for (let i = 0; i < opt.siang.length; i++) sg[opt.siang[i]]--;
    }

    function dfs(step) {
      if (stop) return;
      if (step === order.length) {
        const sc = firstOnly ? 0 : scoreSolution(ctx, chosen);
        if (sc < bestScore) { bestScore = sc; best = chosen.map((o) => o.codes.slice()); }
        if (firstOnly) stop = true;
        return;
      }
      const d = order[step];
      for (const opt of opts[d]) {
        if (++nodes > LIMIT) { stop = true; return; }
        let sun = null;
        if (d === 5) { sun = sundayFromSaturday(ctx, reqs, opt); if (!sun) continue; }
        const ok1 = add(opt);
        const ok2 = sun ? add(sun) : true;
        if (ok1 && ok2) { chosen[d] = opt; if (sun) chosen[6] = sun; dfs(step + 1); }
        if (sun) undo(sun);
        undo(opt);
        if (stop) return;
      }
    }
    dfs(0);
    return best ? { codesByDay: best, score: bestScore } : null;
  }

  function middleCandidates(params, ctx, reqs) {
    const people = params.people;
    const hist = (params.middleHistory || []).slice();
    const lastName = hist.length ? hist[hist.length - 1] : null;
    const lastIdx = lastName ? people.indexOf(lastName) : -1;
    const excl = {};
    excl[ctx.offIdx[4]] = 'Jumat libur → Sabtu wajib kasir siang';
    if (ctx.nextMon >= 0) excl[ctx.nextMon] = 'libur Senin depan → Minggu wajib kasir pagi';
    const strictExcl = Object.assign({}, excl);
    if (lastIdx >= 0) strictExcl[lastIdx] = 'sudah Middle minggu lalu (harus dirotasi)';

    const order = [0, 1, 2, 3, 4].sort((a, b) => {
      const la = hist.lastIndexOf(people[a]);
      const lb = hist.lastIndexOf(people[b]);
      if (la !== lb) return la - lb;
      return ((a - lastIdx - 1 + N) % N) - ((b - lastIdx - 1 + N) % N);
    });

    const mreq = reqs.filter((r) => r.shift === 'Middle');
    let strict, relaxed;
    if (params.middleFixed) {
      const f = people.indexOf(params.middleFixed);
      const why = excl[f];
      if (why) return { error: params.middleFixed + ' tidak bisa jadi Middle: ' + why };
      strict = [f];
      relaxed = [f];
    } else {
      strict = order.filter((p) => !(p in strictExcl));
      relaxed = order.filter((p) => !(p in excl));
    }
    if (mreq.length) {
      strict = strict.filter((p) => p === mreq[0].p);
      relaxed = relaxed.filter((p) => p === mreq[0].p);
    }
    return { strict, relaxed };
  }

  function solveOnce(params, ctx, reqs, firstOnly) {
    const c = middleCandidates(params, ctx, reqs);
    if (c.error) return { error: c.error };
    const tryList = (list) => {
      for (const M of list) {
        const r = searchMiddle(ctx, M, reqs, firstOnly);
        if (r) return { M, r };
      }
      return null;
    };
    let hit = tryList(c.strict);
    let relaxedRotation = false;
    if (!hit && !params.middleFixed) {
      const extra = c.relaxed.filter((p) => c.strict.indexOf(p) < 0);
      hit = tryList(extra);
      relaxedRotation = !!hit;
    }
    return hit ? Object.assign({ relaxedRotation }, hit) : { none: true };
  }

  function whyRejected(ctx, people, req, off) {
    const name = people[req.p];
    if (req.d < 5 && ctx.offIdx[req.d] === req.p) return 'sedang libur di hari itu';
    if (req.shift === 'Middle' && req.d < 5) return 'Middle hanya ada di Sabtu & Minggu';
    if (req.shift === 'Siang' && ctx.forcedPK[req.d] === req.p) return 'sehari sebelum libur wajib masuk Pagi';
    if (req.shift === 'Pagi' && ctx.forcedSK[req.d] === req.p) return 'sehari setelah libur wajib masuk Siang';
    if (req.d >= 5) return 'bertabrakan dengan aturan Sabtu–Minggu (pasangan tetap, shift & tugas bergantian) atau aturan lain';
    return 'bertabrakan dengan aturan lain (jatah 3x Pagi/3x Siang, kasir sebelum/sesudah libur, atau request lain)';
  }

  /*
   * params: {
   *   people: [5 nama], off: [5 nama Sen..Jum],
   *   prev: {sunday: {nama: kode}} | null,
   *   nextMondayOff: nama | null,
   *   middleHistory: [nama...], middleFixed: nama | null,
   *   requests: [{person, day(0-6), shift:'Pagi'|'Siang'|'Middle'}]
   * }
   */
  function solveWeek(params) {
    const people = params.people;
    const chk = checkOff(people, params.off);
    if (!chk.complete) {
      return { ok: false, error: chk.errors.length ? chk.errors.join('; ') : 'Lengkapi dulu hari libur kelima orang (Senin–Jumat).' };
    }
    if (params.nextMondayOff && params.nextMondayOff === params.off[4]) {
      return { ok: false, error: params.nextMondayOff + ' libur Jumat dan Senin depan: Sabtu wajib kasir siang, tapi Minggu wajib kasir pagi (bertabrakan dengan aturan Sabtu–Minggu bergantian). Ubah salah satu hari libur.' };
    }
    const ctx = prepare(params);
    const rejected = [];
    const accepted = [];
    const reqs = [];
    (params.requests || []).forEach((r) => {
      const p = people.indexOf(r.person);
      if (p < 0 || !(r.day >= 0 && r.day < 7) || ['Pagi', 'Siang', 'Middle'].indexOf(r.shift) < 0) return;
      reqs.push({ p, d: r.day, shift: r.shift, src: r });
    });

    const base = solveOnce(params, ctx, [], true);
    if (base.error) return { ok: false, error: base.error };
    if (base.none) {
      return { ok: false, error: 'Tidak ada susunan yang memenuhi semua aturan untuk kombinasi libur ini. Coba ubah hari libur.' };
    }

    const kept = [];
    for (const r of reqs) {
      const pre = whyRejected(ctx, people, r, params.off);
      const simple = (r.d < 5 && ctx.offIdx[r.d] === r.p) ||
        (r.shift === 'Middle' && r.d < 5) ||
        (r.shift === 'Siang' && ctx.forcedPK[r.d] === r.p) ||
        (r.shift === 'Pagi' && ctx.forcedSK[r.d] === r.p);
      if (simple) { rejected.push({ request: r.src, reason: pre }); continue; }
      const test = solveOnce(params, ctx, kept.concat([r]), true);
      if (test.none || test.error) rejected.push({ request: r.src, reason: pre });
      else { kept.push(r); accepted.push(r.src); }
    }

    const fin = solveOnce(params, ctx, kept, false);
    if (!fin || fin.none || fin.error) return { ok: false, error: 'Gagal menyusun jadwal.' };

    const M = fin.M;
    const codesByDay = fin.r.codesByDay;
    const assign = {};
    people.forEach((n, p) => { assign[n] = codesByDay.map((c) => c[p]); });
    const days = codesByDay.map((codes, d) => {
      const o = { off: null, PK: null, PP: null, SK: null, SP: null, M: null };
      codes.forEach((c, p) => { if (c === 'L') o.off = people[p]; else o[c] = people[p]; });
      return o;
    });
    const stats = {};
    people.forEach((n) => {
      const s = { Pagi: 0, Siang: 0, Middle: 0, Kasir: 0, Piket: 0, Libur: 0 };
      assign[n].forEach((c) => {
        s[shiftOf(c)]++;
        if (isKasir(c)) s.Kasir++;
        if (roleOf(c) === 'Piket') s.Piket++;
      });
      stats[n] = s;
    });
    const notes = [];
    if (fin.relaxedRotation) notes.push('Rotasi Middle tidak bisa dipertahankan (aturan lain bentrok), Middle diambil dari orang yang sama seperti minggu lalu.');
    return {
      ok: true, middle: people[M], assign, days, stats,
      off: params.off.slice(), accepted, rejected, notes,
      sunday: Object.fromEntries(people.map((n) => [n, assign[n][6]])),
    };
  }

  /* ---------- audit independen (dipakai tes & bisa dipakai UI) ---------- */

  function auditWeek(people, res, nextMondayOff) {
    const v = [];
    const A = res.assign;
    people.forEach((n) => {
      const off = A[n].map((c, d) => (c === 'L' ? d : -1)).filter((d) => d >= 0);
      if (off.length !== 1) v.push(n + ' libur ' + off.length + 'x');
      else if (off[0] > 4) v.push(n + ' libur di akhir pekan');
      const s = A[n].filter((c) => c !== 'L');
      const pagi = s.filter(isPagi).length, siang = s.filter(isSiang).length;
      const mid = s.filter((c) => c === 'M').length;
      if (n === res.middle) {
        if (!(pagi === 2 && siang === 2 && mid === 2)) v.push(n + ' (middle) jatah salah ' + pagi + '/' + siang + '/' + mid);
      } else if (!(pagi === 3 && siang === 3 && mid === 0)) v.push(n + ' jatah salah ' + pagi + '/' + siang + '/' + mid);
    });
    for (let d = 0; d < 7; d++) {
      const col = people.map((n) => A[n][d]);
      const cnt = (c) => col.filter((x) => x === c).length;
      ['PK', 'PP', 'SK', 'SP'].forEach((c) => { if (cnt(c) !== 1) v.push('Hari ' + DAYS[d] + ' slot ' + c + ' = ' + cnt(c)); });
      if (d < 5) { if (cnt('L') !== 1) v.push('Hari ' + DAYS[d] + ' libur = ' + cnt('L')); if (cnt('M') !== 0) v.push('Middle di hari kerja'); }
      else { if (cnt('M') !== 1) v.push('Hari ' + DAYS[d] + ' middle = ' + cnt('M')); if (cnt('L') !== 0) v.push('Ada libur di akhir pekan'); }
    }
    if (A[res.middle][5] !== 'M' || A[res.middle][6] !== 'M') v.push('Middle Sabtu & Minggu bukan orang yang sama');
    people.forEach((n) => {
      const d = A[n].indexOf('L');
      if (d < 0) return;
      if (d >= 1 && A[n][d - 1] !== 'PK') v.push(n + ' sebelum libur bukan Kasir Pagi');
      if (d <= 3 && A[n][d + 1] !== 'SK') v.push(n + ' setelah libur bukan Kasir Siang');
      if (d === 4 && A[n][5] !== 'SK') v.push(n + ' setelah libur Jumat bukan Kasir Siang (Sabtu)');
    });
    people.forEach((n) => {
      if (n === res.middle) return;
      const sw = { PK: 'SP', PP: 'SK', SK: 'PP', SP: 'PK' }[A[n][5]];
      if (A[n][6] !== sw) v.push(n + ' Sabtu ' + A[n][5] + ' tapi Minggu ' + A[n][6] + ' (harus ' + sw + ': shift & tugas bergantian)');
    });
    if (nextMondayOff && A[nextMondayOff][6] !== 'PK') v.push(nextMondayOff + ' Minggu bukan Kasir Pagi padahal libur Senin depan');
    return v;
  }

  /* ---------- saran hari libur otomatis ---------- */

  /*
   * params: { people, partial:[5 nama|null], prevOff:[5 nama|null]|null, prevMiddle, middleHistory,
   *           prevSunday, settings, requests, nextMondayOff }
   * Mengembalikan {off, relaxed:[catatan]} atau {error}
   */
  function suggestOff(params) {
    const people = params.people;
    const settings = Object.assign({}, DEFAULT_SETTINGS, params.settings || {});
    const partial = params.partial || [null, null, null, null, null];
    const prevMap = params.prevOff ? checkOff(people, params.prevOff).map : {};
    const hasPrev = Object.keys(prevMap).length > 0;
    const history = (params.middleHistory || []).slice();
    const lastMiddle = history.length ? history[history.length - 1] : (params.prevMiddle || null);

    const cands = [];
    PERMS5.forEach((perm, order) => {
      const off = perm.map((i) => people[i]);
      for (let d = 0; d < 5; d++) if (partial[d] && partial[d] !== off[d]) return;
      const map = checkOff(people, off).map;
      let dev = 0, gapBad = 0;
      if (hasPrev) {
        gapBad = gapIssues(prevMap, map, settings).length;
        Object.keys(map).forEach((n) => { if (prevMap[n] !== undefined) dev += Math.abs(map[n] - prevMap[n] - 1); });
      }
      const mondayClash = !!(lastMiddle && off[0] === lastMiddle);
      cands.push({ off, order, dev, gapBad, mondayClash });
    });
    if (!cands.length) return { error: 'Pilihan libur yang sudah diisi tidak memungkinkan (ada nama dobel).' };

    const rank = (a, b) => (a.gapBad - b.gapBad) || (a.dev - b.dev) || (a.order - b.order);
    const tiers = [
      { f: (c) => c.gapBad === 0 && !c.mondayClash, note: null },
      { f: (c) => !c.mondayClash, note: 'Jarak libur dari minggu lalu tidak bisa sepenuhnya sesuai aturan.' },
      { f: () => true, note: 'Aturan jarak libur dan Middle minggu lalu tidak bisa dipenuhi semuanya.' },
    ];
    for (const tier of tiers) {
      const list = cands.filter(tier.f).sort(rank);
      const solveParams = (off) => ({
        people, off, prev: params.prevSunday ? { sunday: params.prevSunday } : null,
        nextMondayOff: params.nextMondayOff || null, middleHistory: history,
        middleFixed: null, requests: [],
      });
      const feasible = [];
      for (const c of list) {
        const r = solveWeek(solveParams(c.off));
        if (r.ok) feasible.push(c);
        if (feasible.length >= 8) break;
      }
      if (!feasible.length) continue;
      // pilih yang paling banyak memenuhi request
      let pick = feasible[0];
      if ((params.requests || []).length) {
        let bestRej = Infinity;
        for (const c of feasible) {
          const r = solveWeek(Object.assign(solveParams(c.off), { requests: params.requests }));
          const rej = r.ok ? r.rejected.length : Infinity;
          if (rej < bestRej) { bestRej = rej; pick = c; }
        }
      }
      return { off: pick.off, relaxed: tier.note ? [tier.note] : [] };
    }
    return { error: 'Tidak ditemukan susunan libur yang valid.' };
  }

  /* ---------- hitung seluruh daftar minggu ---------- */

  /*
   * state: { people, settings, baseline:{prevOff,prevMiddle},
   *          weeks:[{off:[5 nama|null], middle:'auto'|nama, requests:[...]}] }
   * Mengembalikan array hasil per minggu: {result, errors, warnings, notes}
   */
  function computeAll(state) {
    const people = state.people;
    const out = [];
    const history = state.baseline && state.baseline.prevMiddle ? [state.baseline.prevMiddle] : [];
    let prevOff = state.baseline && state.baseline.prevOff ? state.baseline.prevOff : null;
    let prevSunday = null;
    state.weeks.forEach((w, i) => {
      const entry = { result: null, errors: [], warnings: [], notes: [], nextMondayOff: null };
      const next = state.weeks[i + 1];
      const nextMondayOff = next && next.off && next.off[0] ? next.off[0] : null;
      entry.nextMondayOff = nextMondayOff;
      const chk = checkOff(people, w.off);
      if (chk.errors.length) entry.errors.push(...chk.errors);
      if (prevOff) {
        const pm = checkOff(people, prevOff).map;
        gapIssues(pm, chk.map, state.settings).forEach((g) => entry.warnings.push(g.text));
      }
      if (chk.complete) {
        const res = solveWeek({
          people, off: w.off, prev: prevSunday ? { sunday: prevSunday } : null,
          nextMondayOff, middleHistory: history.slice(),
          middleFixed: w.middle && w.middle !== 'auto' ? w.middle : null,
          requests: w.requests || [],
        });
        if (res.ok) {
          entry.result = res;
          res.rejected.forEach((r) => entry.warnings.push(
            'Request ' + r.request.person + ' ' + DAYS[r.request.day] + ' ' + r.request.shift + ' tidak bisa dipenuhi: ' + r.reason + '.'));
          res.notes.forEach((n) => entry.notes.push(n));
          history.push(res.middle);
          prevSunday = res.sunday;
        } else {
          entry.errors.push(res.error);
          prevSunday = null;
        }
      } else if (!chk.errors.length) {
        entry.errors.push('Pilih 5 orang untuk hari libur Senin–Jumat (tiap orang tepat sekali).');
        prevSunday = null;
      } else prevSunday = null;
      prevOff = w.off;
      out.push(entry);
    });
    return out;
  }

  /* ---------- tanggal ---------- */

  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function fmtISO(dt) {
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  }
  function addDays(s, n) { const dt = parseDate(s); dt.setUTCDate(dt.getUTCDate() + n); return fmtISO(dt); }
  function snapToMonday(s) {
    const dt = parseDate(s);
    const dow = dt.getUTCDay();
    dt.setUTCDate(dt.getUTCDate() - ((dow + 6) % 7));
    return fmtISO(dt);
  }
  function nextMonday(s) {
    const dt = parseDate(s);
    const dow = dt.getUTCDay();
    const add = dow === 1 ? 0 : ((8 - dow) % 7) || 7;
    dt.setUTCDate(dt.getUTCDate() + add);
    return fmtISO(dt);
  }

  return {
    DAYS, DAYS_SHORT, SLOT_LABEL, DEFAULT_SETTINGS,
    isPagi, isSiang, isKasir, shiftOf, roleOf,
    checkOff, gapIssues, solveWeek, suggestOff, computeAll, auditWeek,
    parseDate, fmtISO, addDays, snapToMonday, nextMonday,
  };
});
