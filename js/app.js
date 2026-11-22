(function () {
  'use strict';
  const S = window.Scheduler;
  const X = window.XlsxLite;
  const KEY = 'mixue-sch-v1';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const MONTHS_FULL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const SHIFTS = ['Pagi', 'Siang', 'Middle'];
  const TIMES = { Pagi: '08.00–17.00', Middle: '11.00–20.00', Siang: '13.00–22.00' };
  const DOT = { pagi: '#f4a3a8', siang: '#e4202b', middle: '#7e0f16', libur: '#d9cfcf' };
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');
  const $nav = document.getElementById('nav');
  // 'admin' = Mixue Penguasa (membuat jadwal), 'viewer' = Mixue Rakyat (hanya menerima jadwal)
  const ROLE = window.MIXUE_ROLE === 'viewer' ? 'viewer' : 'admin';
  const Y = window.MixueSync;
  const POLL_MS = window.MIXUE_POLL_MS || 60000;
  document.title = ROLE === 'viewer' ? 'Mixue Rakyat' : 'Mixue Penguasa';

  /* ---------- mode aplikasi Android (Capacitor) ---------- */
  const isNative = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  if (isNative) document.documentElement.classList.add('native');
  const plugins = () => (window.Capacitor && window.Capacitor.Plugins) || {};
  // ikon status bar (jam, sinyal, wifi, baterai) hitam agar terbaca di latar terang
  if (isNative) {
    try { const sb = plugins().StatusBar; if (sb) { sb.setStyle({ style: 'LIGHT' }); } } catch (e) { /* abaikan */ }
  }

  /* ---------- util ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function todayISO() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dmy(iso) { const d = S.parseDate(iso); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function dm(iso) { const d = S.parseDate(iso); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
  function sheetDate(iso) { const d = S.parseDate(iso); return d.getUTCDate() + '-' + MONTHS[d.getUTCMonth()] + '-' + String(d.getUTCFullYear()).slice(2); }
  function longDate(iso) {
    const d = S.parseDate(iso);
    return S.DAYS[(d.getUTCDay() + 6) % 7] + ', ' + d.getUTCDate() + ' ' + MONTHS_FULL[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function range(start) {
    const a = S.parseDate(start), b = S.parseDate(S.addDays(start, 6));
    if (a.getUTCMonth() === b.getUTCMonth()) return a.getUTCDate() + '–' + b.getUTCDate() + ' ' + MONTHS[b.getUTCMonth()] + ' ' + b.getUTCFullYear();
    return dmy(start) + ' – ' + dmy(S.addDays(start, 6));
  }
  let toastTimer = null;
  function flash(msg) {
    $toast.textContent = msg; $toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $toast.classList.remove('show'), 4200);
  }

  /* ---------- ikon (garis minimalis) ---------- */
  const ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    sunset: '<path d="M17 18a5 5 0 0 0-10 0"/><path d="M12 9v3M4.2 10.2l1.5 1.5M1 18h2M21 18h2M18.3 11.7l1.5-1.5M23 22H1M16 5l-4 4-4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  };
  const svg = (n, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + ICONS[n] + '</svg>';
  const ICON_OF = { pagi: 'sun', siang: 'sunset', middle: 'clock', libur: 'home' };

  /* ---------- state ---------- */
  function newWeek() { return { off: [null, null, null, null, null], middle: 'auto', requests: [] }; }
  function defaultState() {
    return {
      version: 1,
      people: ['', '', '', '', ''],
      settings: { minGap: S.DEFAULT_SETTINGS.minGap, maxGap: S.DEFAULT_SETTINGS.maxGap },
      baseline: { prevOff: [null, null, null, null, null], prevMiddle: null },
      startDate: S.snapToMonday(todayISO()),
      weeks: [newWeek()],
      me: null,
      tourDone: false,
      role: ROLE,
      // khusus Mixue Rakyat
      code: '', admin: '', snap: null, etag: '', meName: '', checkedAt: 0, syncAt: 0, syncErr: '',
    };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.role !== undefined && s.role !== ROLE) return defaultState();
      if (s && s.role === undefined && ROLE === 'viewer') return defaultState();
      if (s && s.version === 1 && Array.isArray(s.people) && s.people.length === 5 && Array.isArray(s.weeks) && s.weeks.length) {
        // data versi lama memakai 5 nama bawaan: mulai bersih agar tidak ada nama otomatis
        if (s.people.join('|') === 'Ahmad|Ferri|Budi|Tamam|Ainun') return defaultState();
        if (s.me === undefined || s.me === null || !(s.me >= 0 && s.me < 5)) s.me = null;
        return Object.assign(defaultState(), s, { role: ROLE });
      }
    } catch (e) { /* abaikan */ }
    return defaultState();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* abaikan */ }
    if (ROLE === 'admin') schedulePublish();
  }
  let state = load();

  const ui = { codeDraft: '', codeError: '', codeBusy: false, tokenDraft: '', tokenError: '', fx: false, tab: 'me', sel: 0, selDay: null, nameDraft: '', nameError: '', step: 'welcome', myName: '', peopleDraft: ['', '', '', '', ''] };
  function currentWeekIndex() {
    const diff = Math.floor((S.parseDate(todayISO()) - S.parseDate(state.startDate)) / 864e5 / 7);
    return Math.max(0, Math.min(state.weeks.length - 1, diff));
  }
  ui.sel = currentWeekIndex();

  const names = () => state.people.map((n) => String(n).trim());
  function namesValid() { const n = names(); return n.every(Boolean) && new Set(n.map((x) => x.toLowerCase())).size === 5; }

  function engineState() {
    const n = names();
    const nm = (i) => (i == null ? null : n[i]);
    const hasBase = state.baseline.prevOff.some((x) => x != null);
    return {
      people: n,
      settings: state.settings,
      baseline: { prevOff: hasBase ? state.baseline.prevOff.map(nm) : null, prevMiddle: nm(state.baseline.prevMiddle) },
      weeks: state.weeks.map((w) => ({
        off: w.off.map(nm),
        middle: w.middle === 'auto' || w.middle == null ? 'auto' : n[w.middle],
        requests: w.requests.map((r, i) => ({ person: n[r.p], day: r.day, shift: r.shift, i })),
      })),
    };
  }
  let cacheKey = '', cacheVal = null;
  let vcache = { snap: null, val: [] };
  function computed() {
    if (ROLE === 'viewer') {
      if (vcache.snap !== state.snap) vcache = { snap: state.snap, val: state.snap ? Y.toEntries(state.snap) : [] };
      return vcache.val;
    }
    const k = JSON.stringify([state.people, state.settings, state.baseline, state.weeks]);
    if (k !== cacheKey) { cacheVal = S.computeAll(engineState()); cacheKey = k; }
    return cacheVal;
  }

  function suggestFor(w) {
    const eng = engineState();
    const before = S.computeAll(Object.assign({}, eng, { weeks: eng.weeks.slice(0, w) }));
    const history = [];
    if (eng.baseline.prevMiddle) history.push(eng.baseline.prevMiddle);
    before.forEach((b) => { if (b.result) history.push(b.result.middle); });
    const last = before[w - 1];
    const next = eng.weeks[w + 1];
    return S.suggestOff({
      people: eng.people,
      partial: eng.weeks[w].off,
      prevOff: w > 0 ? eng.weeks[w - 1].off : eng.baseline.prevOff,
      prevMiddle: eng.baseline.prevMiddle,
      middleHistory: history,
      prevSunday: last && last.result ? last.result.sunday : null,
      settings: state.settings,
      requests: eng.weeks[w].requests,
      nextMondayOff: next && next.off[0] ? next.off[0] : null,
    });
  }
  function applySuggestion(w) {
    const sg = suggestFor(w);
    if (!sg.off) { flash(sg.error || 'Tidak bisa menyarankan libur.'); return false; }
    const n = names();
    state.weeks[w].off = sg.off.map((x) => n.indexOf(x));
    if (sg.relaxed && sg.relaxed.length) flash(sg.relaxed.join(' '));
    return true;
  }

  /* ---------- data tampilan ---------- */
  function info(code) {
    const sh = S.shiftOf(code), role = S.roleOf(code);
    const key = sh === 'Pagi' ? 'pagi' : sh === 'Siang' ? 'siang' : sh === 'Middle' ? 'middle' : 'libur';
    return { sh, role, key, time: TIMES[sh] || '' };
  }
  function weekStart(i) { return S.addDays(state.startDate, i * 7); }
  function sheetModel(i) {
    const e = computed()[i];
    if (!e || !e.result) return null;
    const res = e.result, start = weekStart(i);
    const U = (v) => (v ? String(v).toUpperCase() : '');
    return {
      days: S.DAYS.map((n, d) => ({ name: n.toUpperCase(), date: sheetDate(S.addDays(start, d)) })),
      pagiK: res.days.map((x) => U(x.PK)),
      pagiP: res.days.map((x) => U(x.PP)),
      middle: res.days.map((x, d) => (d >= 5 ? U(x.M) : '')),
      siangK: res.days.map((x) => U(x.SK)),
      siangP: res.days.map((x) => U(x.SP)),
      off: res.days.map((x, d) => (d < 5 ? U(x.off) : '')),
    };
  }

  /* ---------- komponen ---------- */
  function optionTags(selected, blank) {
    const n = names();
    let h = blank == null ? '' : '<option value="">' + esc(blank) + '</option>';
    n.forEach((name, i) => { h += '<option value="' + i + '"' + (selected === i ? ' selected' : '') + '>' + esc(name || ('Orang ' + (i + 1))) + '</option>'; });
    return h;
  }
  function weekNav() {
    const w = ui.sel;
    return '<div class="weeknav"><button class="iconbtn" data-action="wk:-1" aria-label="Minggu sebelumnya"' + (w === 0 ? ' disabled' : '') + '>‹</button>' +
      '<div class="lbl">Minggu ' + (w + 1) + '<span>' + esc(range(weekStart(w))) + '</span></div>' +
      '<button class="iconbtn" data-action="wk:1" aria-label="Minggu berikutnya"' + (w >= state.weeks.length - 1 ? ' disabled' : '') + '>›</button></div>';
  }
  /* ---------- navbar bawah: lekukan meluncur ke tab aktif ---------- */
  const TABS = [['me', 'Jadwalku', 'user'], ['all', 'Lengkap', 'grid'], ['set', 'Atur', 'sliders']];
  const NOTCH = { w: 48, d: 33, r: 22, cy: 4 }; // lebar bahu, kedalaman, jari-jari lingkaran, pusat-y lingkaran
  const NAV = { built: false, tab: null, x: 0, raf: 0, bar: null, path: null, orb: null };
  const eio = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const backOut = (u) => { const c1 = 1.3, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
  const navBtn = (id) => $nav.querySelector('button[data-tab="' + id + '"]');
  const navIcon = (id) => svg(TABS.filter((t) => t[0] === id)[0][2]);

  function navBuild() {
    $nav.innerHTML = '<svg class="bar" aria-hidden="true"><path d=""/></svg><div class="in">' +
      TABS.map((t) => '<button data-action="tab:' + t[0] + '" data-tab="' + t[0] + '" aria-label="' + t[1] + '">' + svg(t[2]) + t[1] + '</button>').join('') +
      '</div><div class="orb" aria-hidden="true"></div>';
    $nav.hidden = false;
    NAV.bar = $nav.querySelector('.bar'); NAV.path = NAV.bar.querySelector('path'); NAV.orb = $nav.querySelector('.orb');
    NAV.built = true; NAV.tab = null;
  }
  function navX(id) {
    const r = navBtn(id).getBoundingClientRect(), n = $nav.getBoundingClientRect();
    return r.left - n.left + r.width / 2;
  }
  // x = pusat lekukan, f = kedalaman (0 rata, 1 penuh, >1 membal)
  function navDraw(x, f) {
    const W = $nav.clientWidth, H = $nav.clientHeight;
    NAV.bar.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const d = NOTCH.d * f, w = NOTCH.w, xs = x - w, xe = x + w;
    const fl = (n) => Math.round(n * 100) / 100;
    NAV.path.setAttribute('d', f < 0.03
      ? 'M0 0H' + W + 'V' + H + 'H0Z'
      : 'M0 0H' + fl(xs) + 'C' + fl(xs + 20) + ' 0 ' + fl(x - 28) + ' ' + fl(d) + ' ' + fl(x) + ' ' + fl(d) +
        'C' + fl(x + 28) + ' ' + fl(d) + ' ' + fl(xe - 20) + ' 0 ' + fl(xe) + ' 0H' + W + 'V' + H + 'H0Z');
    const g = Math.max(0, Math.min(f, 1.15));
    const cy = NOTCH.cy + (1 - g) * 22, sc = 0.3 + 0.7 * g;
    NAV.orb.style.transform = 'translate3d(' + fl(x - NOTCH.r) + 'px,' + fl(cy - NOTCH.r) + 'px,0) scale(' + fl(sc) + ')';
  }
  function navMark(id, on) {
    const b = navBtn(id); if (!b) return;
    b.classList.toggle('on', on); b.classList.toggle('hid', on);
  }
  function navSet(id) { // tanpa animasi
    cancelAnimationFrame(NAV.raf);
    TABS.forEach((t) => navMark(t[0], t[0] === id));
    NAV.orb.innerHTML = navIcon(id); NAV.tab = id; NAV.x = navX(id); navDraw(NAV.x, 1);
  }
  function navGo(id) {
    if (!NAV.built) navBuild();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (NAV.tab == null || reduce) { navSet(id); return; }
    if (NAV.tab === id) return;
    cancelAnimationFrame(NAV.raf);
    const from = NAV.tab, x0 = NAV.x, x1 = navX(id), t0 = performance.now(), DUR = 680;
    NAV.tab = id;
    navMark(from, false); // ikon lama muncul kembali
    let swapped = false, hid = false;
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / DUR);
      let f, x = x0;
      if (t < 0.28) f = 1 - 0.9 * eio(t / 0.28);              // lingkaran tenggelam
      else if (t < 0.62) { f = 0.1; x = x0 + (x1 - x0) * eio((t - 0.28) / 0.34); } // lekukan meluncur
      else { f = 0.1 + 0.9 * backOut((t - 0.62) / 0.38); x = x1; } // naik lagi, sedikit membal
      if (t >= 0.5 && !swapped) { swapped = true; NAV.orb.innerHTML = navIcon(id); const b = navBtn(id); if (b) b.classList.add('on'); }
      if (t >= 0.6 && !hid) { hid = true; const b = navBtn(id); if (b) b.classList.add('hid'); }
      navDraw(x, f);
      if (t < 1) NAV.raf = requestAnimationFrame(frame); else { NAV.x = x1; navDraw(x1, 1); }
    };
    NAV.raf = requestAnimationFrame(frame);
  }
  function navSync(show) {
    if (!show) {
      cancelAnimationFrame(NAV.raf); $nav.hidden = true; $nav.innerHTML = ''; NAV.built = false; NAV.tab = null; return;
    }
    if (NAV.built && NAV.tab === ui.tab) return;
    navGo(ui.tab);
  }
  window.addEventListener('resize', () => { if (NAV.built && NAV.tab) navSet(NAV.tab); });

  function inMain() {
    return ROLE === 'viewer' ? !!(state.code && state.snap && state.me != null) : (namesValid() && state.me != null);
  }
  function msgBlock(entry) {
    const msgs = [];
    entry.errors.forEach((m) => msgs.push('<div class="msg err">' + esc(m) + '</div>'));
    entry.warnings.forEach((m) => msgs.push('<div class="msg warn">' + esc(m) + '</div>'));
    entry.notes.forEach((m) => msgs.push('<div class="msg info">' + esc(m) + '</div>'));
    return msgs.length ? '<div class="msgs">' + msgs.join('') + '</div>' : '';
  }
  function emptyState(entry) {
    if (ROLE === 'viewer') {
      return '<div class="card empty"><b>Jadwal minggu ini belum dibuat</b>Admin belum membuat jadwal untuk minggu ini. Jadwal akan muncul otomatis begitu admin menyimpannya.</div>';
    }
    return '<div class="card empty"><b>Jadwal minggu ini belum dibuat</b>Pilih hari libur kelima orang di tab Atur, atau biarkan sistem mengisinya otomatis.' +
      '<br><button class="primary" data-action="gotoset">Buka Atur</button></div>' + (entry && entry.errors.length && entry.errors.some((e) => !/^Pilih 5 orang/.test(e)) ? msgBlock({ errors: entry.errors.filter((e) => !/^Pilih 5 orang/.test(e)), warnings: [], notes: [] }) : '');
  }

  /* ---------- tab 1: Jadwalku ---------- */
  function viewMe() {
    const all = computed(), w = ui.sel, entry = all[w], res = entry && entry.result;
    const start = weekStart(w), me = names()[state.me];
    let h = '<div class="head"><div><h1>Halo, ' + esc(me) + '</h1><div class="date">' + esc(longDate(todayISO())) + '</div></div>' +
      '<button class="avatar" data-action="chname" aria-label="Ganti nama">' + esc(me.charAt(0).toUpperCase()) + '</button></div>';
    h += weekNav();
    if (!res) return h + emptyState(entry);

    const codes = res.assign[me];
    const diff = Math.round((S.parseDate(todayISO()) - S.parseDate(start)) / 864e5);
    const todayIdx = diff >= 0 && diff <= 6 ? diff : -1;
    const dsel = ui.selDay != null ? ui.selDay : (todayIdx >= 0 ? todayIdx : 0);

    h += '<div class="strip">';
    for (let d = 0; d < 7; d++) {
      const inf = info(codes[d]);
      h += '<button data-action="day:' + d + '" class="' + (d === todayIdx ? 'today ' : '') + (d === dsel ? 'sel' : '') + '" aria-label="' + S.DAYS[d] + '">' +
        S.DAYS_SHORT[d] + '<span class="num">' + S.parseDate(S.addDays(start, d)).getUTCDate() + '</span><span class="dot" style="background:' + DOT[inf.key] + '"></span></button>';
    }
    h += '</div>';

    const hi = info(codes[dsel]);
    h += '<div class="hero"><div><div class="k">' + (dsel === todayIdx ? 'Hari ini · ' : '') + esc(S.DAYS[dsel]) + ', ' + esc(dm(S.addDays(start, dsel))) + '</div>' +
      '<div class="big">' + esc(hi.key === 'libur' ? 'Libur' : hi.sh) + '</div>' +
      '<div class="sub">' + esc(hi.key === 'libur' ? 'Selamat istirahat' : (hi.role ? hi.role + ' · ' : '') + hi.time) + '</div></div>' +
      '<div style="color:#fff">' + svg(ICON_OF[hi.key], ' width="78" height="78" stroke-width="1.2"') + '</div></div>';

    const st = res.stats[me];
    h += '<div class="sumrow"><span class="pill pagi">' + st.Pagi + ' Pagi</span><span class="pill siang">' + st.Siang + ' Siang</span>' +
      (st.Middle ? '<span class="pill middle">' + st.Middle + ' Middle</span>' : '') + '<span class="pill libur">' + st.Libur + ' Libur</span></div>';

    h += '<div class="list">';
    for (let d = 0; d < 7; d++) {
      const inf = info(codes[d]);
      h += '<button class="item' + (d === dsel ? ' sel' : '') + '" data-action="day:' + d + '"><span class="chip ' + inf.key + '">' + svg(ICON_OF[inf.key]) + '</span>' +
        '<span class="t"><b>' + esc(S.DAYS[d]) + ', ' + esc(dm(S.addDays(start, d))) + '</b><span>' +
        esc(inf.key === 'libur' ? 'Libur' : inf.sh + (inf.role ? ' · ' + inf.role : '')) + '</span></span>' +
        '<span class="tm">' + esc(inf.time) + '</span></button>';
    }
    h += '</div>';
    h += '<div class="row" style="margin-top:14px"><button data-action="sharemy:' + w + '">' + (isNative ? 'Bagikan jadwalku' : 'Salin jadwalku') + '</button></div>';
    return h;
  }

  /* ---------- tab 2: Jadwal lengkap ---------- */
  function sheetTable(m) {
    const row = (cells, cls) => cells.map((v) => '<td class="' + cls + '">' + esc(v) + '</td>').join('');
    const blank = ['', '', '', '', '', '', ''];
    let h = '<div class="sheetwrap"><table class="sheet"><thead><tr><th>SHIFT</th>' +
      m.days.map((d) => '<th>' + esc(d.name) + '<br>' + esc(d.date.replace(/-\d\d$/, '')) + '</th>').join('') + '</tr></thead><tbody>';
    h += '<tr><td class="lab" rowspan="3">PAGI</td>' + row(m.pagiK, 'kasir') + '</tr><tr>' + row(m.pagiP, 'piket') + '</tr><tr>' + row(blank, 'ex') + '</tr>';
    h += '<tr><td class="midlab">MIDDLE</td>' + row(m.middle, 'mid') + '</tr>';
    h += '<tr><td class="lab" rowspan="4">SIANG</td>' + row(m.siangK, 'kasir') + '</tr><tr>' + row(m.siangP, 'piket') + '</tr><tr>' + row(blank, 'ex') + '</tr><tr>' + row(blank, 'ex') + '</tr>';
    h += '<tr><td class="offlab" rowspan="2">OFF</td>' + row(m.off, 'off') + '</tr><tr>' + row(blank, 'off') + '</tr>';
    h += '<tr><td colspan="8" class="legk">KOLOM PUTIH JADWAL KASIR</td></tr><tr><td colspan="8" class="legp">KOLOM BIRU JADWAL PIKET</td></tr>';
    h += '</tbody></table></div>';
    h += '<table class="jam"><tr><th colspan="2">JAM KERJA</th></tr>' +
      X.JAM_KERJA.map((j) => '<tr><td>' + j[0] + '</td><td>' + j[1] + '</td></tr>').join('') + '</table>';
    return h;
  }
  function viewAll() {
    const w = ui.sel, entry = computed()[w], m = sheetModel(w);
    let h = '<div class="head"><div><h1>Jadwal Lengkap</h1><div class="date">Semua 5 orang · ' + esc(range(weekStart(w))) + '</div></div></div>';
    h += weekNav();
    if (!m) return h + emptyState(entry);
    h += '<div class="card" style="padding:10px">' + sheetTable(m) + '</div>';
    h += '<div class="row"><button class="primary" data-action="xlsx:' + w + '">Ekspor ke WPS (.xlsx)</button>' +
      '<button data-action="' + (isNative ? 'share' : 'copy') + ':' + w + '">' + (isNative ? 'Bagikan teks' : 'Salin teks') + '</button></div>';
    if (isNative) h += '<p class="muted small">Setelah menekan Ekspor, pilih WPS Office di daftar aplikasi untuk membuka file.</p>';
    if (entry.warnings.length || entry.notes.length) h += msgBlock({ errors: [], warnings: entry.warnings, notes: entry.notes });
    return h;
  }

  /* ---------- tab 3: Atur ---------- */
  function nameInputs() {
    let h = '<div class="grid2">';
    state.people.forEach((name, i) => { h += '<label class="field">Orang ' + (i + 1) + '<input type="text" data-field="name:' + i + '" value="' + esc(name) + '" maxlength="30"></label>'; });
    return h + '</div>';
  }
  function viewSet() {
    if (ROLE === 'viewer') return viewSetViewer();
    const w = ui.sel, wk = state.weeks[w], entry = computed()[w], start = weekStart(w);
    let h = '<div class="head"><div><h1>Atur Jadwal</h1><div class="date">Libur, request, dan pengaturan</div></div></div>';
    h += weekNav();

    h += '<div class="card"><h2>Hari libur</h2><p class="muted small" style="margin:2px 0 12px">Pilih siapa yang libur tiap hari. Sabtu & Minggu semua masuk.</p><div class="offlist">';
    for (let d = 0; d < 5; d++) {
      h += '<label><span>' + S.DAYS[d] + '<small>' + esc(dm(S.addDays(start, d))) + '</small></span><select data-field="off:' + w + ':' + d + '" aria-label="Libur ' + S.DAYS[d] + '">' + optionTags(wk.off[d], '— pilih —') + '</select></label>';
    }
    h += '</div><div class="row" style="margin-top:14px"><button class="accent" data-action="auto:' + w + '">Isi libur otomatis</button><button class="ghost" data-action="clear:' + w + '">Kosongkan</button></div>';
    h += '<h3>Middle Sabtu–Minggu</h3><select data-field="mid:' + w + '" aria-label="Middle minggu ini"><option value="auto"' + (wk.middle === 'auto' ? ' selected' : '') + '>Otomatis (dirotasi)</option>' + optionTags(wk.middle === 'auto' ? null : wk.middle) + '</select>';
    h += '</div>';
    h += msgBlock(entry);

    // request
    const rejected = {};
    if (entry.result) entry.result.rejected.forEach((r) => { rejected[r.request.i] = r.reason; });
    h += '<div class="card"><h2>Request masuk shift</h2><p class="muted small" style="margin:2px 0 12px">Dipenuhi selama tidak melanggar aturan.</p>';
    wk.requests.forEach((r, ri) => {
      h += '<div class="req"><select data-field="reqP:' + w + ':' + ri + '" aria-label="Nama">' + optionTags(r.p) + '</select><select data-field="reqD:' + w + ':' + ri + '" aria-label="Hari">';
      S.DAYS.forEach((dn, d) => { h += '<option value="' + d + '"' + (r.day === d ? ' selected' : '') + '>' + dn + '</option>'; });
      h += '</select><select data-field="reqS:' + w + ':' + ri + '" aria-label="Shift">';
      SHIFTS.forEach((s) => { h += '<option' + (r.shift === s ? ' selected' : '') + '>' + s + '</option>'; });
      h += '</select><button class="ghost iconbtn" data-action="delreq:' + w + ':' + ri + '" aria-label="Hapus request">×</button></div>';
      if (entry.result) h += rejected[ri] !== undefined ? '<div class="reqs no">Tidak bisa: ' + esc(rejected[ri]) + '</div>' : '<div class="reqs ok">Dipenuhi</div>';
      else h += '<div style="height:8px"></div>';
    });
    h += '<button data-action="addreq:' + w + '">+ Tambah request</button></div>';

    // minggu
    h += '<div class="row" style="margin-bottom:14px"><button class="primary" data-action="addweek">+ Tambah minggu berikutnya</button>' +
      (w === state.weeks.length - 1 && state.weeks.length > 1 ? '<button class="ghost danger" data-action="remove:' + w + '">Hapus minggu ini</button>' : '') + '</div>';

    h += syncCardAdmin();

    // pengaturan
    h += '<details class="card"><summary>Pengaturan</summary>';
    h += '<h3 style="margin-top:0">Aku adalah</h3><select data-field="me">' + optionTags(state.me) + '</select>';
    h += '<h3>Nama 5 orang</h3>' + nameInputs();
    h += '<h3>Tanggal minggu pertama</h3><label class="field" style="max-width:240px">Dibulatkan ke hari Senin<input type="date" data-field="start" value="' + esc(state.startDate) + '"></label>';
    h += '<h3>Jarak antar libur (hari)</h3><div class="grid2"><label class="field">Minimal (terlalu dekat)<input type="number" min="1" max="14" data-field="gap:minGap" value="' + state.settings.minGap + '"></label>' +
      '<label class="field">Maksimal (terlalu jauh)<input type="number" min="1" max="14" data-field="gap:maxGap" value="' + state.settings.maxGap + '"></label></div>';
    h += '<p class="muted small">Bawaan 4–9 hari: Jumat → Senin terlalu dekat, Senin → Kamis/Jumat terlalu jauh.</p>';
    h += '<h3>Minggu sebelumnya (opsional)</h3><p class="muted small" style="margin-top:0">Isi bila jadwal sudah berjalan, supaya jarak libur dan rotasi Middle ikut diperhitungkan.</p><div class="grid2">';
    for (let d = 0; d < 5; d++) h += '<label class="field">Libur ' + S.DAYS[d] + '<select data-field="baseOff:' + d + '">' + optionTags(state.baseline.prevOff[d], '—') + '</select></label>';
    h += '<label class="field">Middle minggu lalu<select data-field="baseMid">' + optionTags(state.baseline.prevMiddle, '—') + '</select></label></div>';
    h += '<div class="row" style="margin-top:16px"><button data-action="tour">Lihat panduan</button><button class="danger" data-action="reset">Reset semua data</button></div></details>';

    h += '<details class="card"><summary>Aturan yang dipakai</summary><ul class="rules">' +
      '<li>Libur 1x seminggu, hanya Senin–Jumat. Sabtu & Minggu dilarang libur.</li>' +
      '<li>Senin–Jumat: Pagi (Kasir + Piket), Siang (Kasir + Piket), 1 orang libur.</li>' +
      '<li>Sabtu–Minggu: Pagi (Kasir + Piket), Middle, Siang (Kasir + Piket).</li>' +
      '<li>Middle Sabtu & Minggu orang yang sama, dirotasi tiap minggu.</li>' +
      '<li>Sabtu–Minggu: pasangan tetap sama, shift bergantian (Sabtu Pagi → Minggu Siang, dan sebaliknya), tugas juga bergantian (Kasir ↔ Piket).</li>' +
      '<li>Sehari sebelum libur wajib Pagi (Kasir); sehari setelah libur wajib Siang (Kasir).</li>' +
      '<li>Yang kasir pagi hari Minggu = yang libur Senin berikutnya.</li>' +
      '<li>Yang dapat Middle 2x Pagi + 2x Siang; lainnya 3x Pagi + 3x Siang.</li>' +
      '<li>Jarak libur antar minggu tidak terlalu jauh / dekat.</li></ul></details>';
    return h;
  }

  /* ---------- tanya nama & perbaiki nama ---------- */
  function viewOnboarding() {
    const n = names();
    const viewer = ROLE === 'viewer';
    let h = '<div class="onb"><div class="logo" aria-hidden="true">M</div><div><h1>Halo! Siapa namamu?</h1>' +
      '<p class="muted" style="margin:6px 0 0">' + (viewer ? 'Pilih atau ketik namamu, lalu jadwalmu langsung tampil.' : 'Ketik namamu, lalu jadwalmu minggu ini langsung tampil.') + '</p></div>' +
      '<input type="text" id="nameInput" data-field="nameDraft" placeholder="Ketik namamu" autocomplete="off" autocapitalize="words" value="' + esc(ui.nameDraft) + '">';
    if (ui.nameError) h += '<div class="msg err">' + esc(ui.nameError) + '</div>';
    h += '<div class="chips">' + n.map((x, i) => (viewer && x === state.admin ? '' : '<button data-action="pick:' + i + '">' + esc(x) + '</button>')).join('') + '</div>' +
      '<button class="primary" data-action="submitname" style="padding:12px">Lanjut</button>' +
      (viewer ? '<button class="ghost" data-action="changecode">Ganti kode admin</button></div>'
        : '<details class="card" style="margin:6px 0 0"><summary>Namamu tidak ada? Ubah daftar nama</summary>' + nameInputs() + '</details></div>');
    return h;
  }
  function viewWelcome() {
    let h = '<div class="onb"><div class="logo" aria-hidden="true">M</div><div><h1>Halo! Siapa namamu?</h1>' +
      '<p class="muted" style="margin:6px 0 0">Setelah ini kamu mengisi nama semua orang yang masuk jadwal.</p></div>' +
      '<input type="text" id="nameInput" data-field="nameDraft" placeholder="Ketik namamu" autocomplete="off" autocapitalize="words" value="' + esc(ui.nameDraft) + '">';
    if (ui.nameError) h += '<div class="msg err">' + esc(ui.nameError) + '</div>';
    return h + '<button class="primary" data-action="welcomenext" style="padding:12px">Lanjut</button></div>';
  }
  function viewPeople() {
    let h = '<div class="onb"><div class="logo" aria-hidden="true">M</div><div><h1>Siapa saja di jadwal?</h1>' +
      '<p class="muted" style="margin:6px 0 0">Isi nama kelima orang yang akan diatur jadwalnya, termasuk kamu (<b>' + esc(ui.myName) + '</b>).</p></div><div class="grid2">';
    ui.peopleDraft.forEach((v, i) => {
      h += '<label class="field">Orang ' + (i + 1) + '<input type="text" data-field="pd:' + i + '" placeholder="Nama orang ' + (i + 1) + '" maxlength="30" autocomplete="off" autocapitalize="words" value="' + esc(v) + '"></label>';
    });
    h += '</div>';
    if (ui.nameError) h += '<div class="msg err">' + esc(ui.nameError) + '</div>';
    return h + '<div class="row"><button class="ghost" data-action="peopleback">Kembali</button>' +
      '<button class="primary" data-action="savepeople" style="flex:1;padding:12px">Simpan & lanjut</button></div></div>';
  }
  function viewFixNames() {
    return '<div class="onb"><div class="logo" aria-hidden="true">M</div><div><h1>Isi 5 nama dulu</h1></div>' +
      '<div class="msg err">Kelima nama harus terisi dan tidak boleh sama.</div>' + nameInputs() + '</div>';
  }

  /* ---------- render ---------- */
  function render() {
    const open = {};
    document.querySelectorAll('details.card').forEach((d, i) => { open[i] = d.open; });
    const y = window.scrollY;
    let h;
    const mainHtml = () => '<main' + (ui.fx ? ' class="fx"' : '') + '>' + (ui.tab === 'all' ? viewAll() : ui.tab === 'set' ? viewSet() : viewMe()) + '</main>';
    if (ROLE === 'viewer') {
      if (!state.code || !state.snap) h = viewCode();
      else if (state.me == null) h = viewOnboarding();
      else h = mainHtml();
    } else if (!namesValid()) h = state.me != null ? viewFixNames() : (ui.step === 'people' ? viewPeople() : viewWelcome());
    else if (state.me == null) h = viewOnboarding();
    else h = mainHtml();
    ui.fx = false;
    $app.innerHTML = h;
    navSync(inMain());
    maybeTour();
    document.querySelectorAll('details.card').forEach((d, i) => { if (open[i]) d.open = true; });
    window.scrollTo(0, y);
  }
  function go(tab) { if (tab !== ui.tab) ui.fx = true; ui.tab = tab; render(); window.scrollTo(0, 0); }

  /* ---------- teks, berbagi, ekspor ---------- */
  function weekText(i) {
    const e = computed()[i]; if (!e || !e.result) return '';
    const res = e.result, start = weekStart(i);
    let t = 'JADWAL ' + range(start) + '\nMiddle Sab–Min: ' + res.middle + '\n';
    for (let d = 0; d < 7; d++) {
      const x = res.days[d];
      t += '\n' + S.DAYS[d] + ' ' + dm(S.addDays(start, d)) + '\n';
      t += 'Pagi  : Kasir ' + x.PK + ', Piket ' + x.PP + '\n';
      if (d >= 5) t += 'Middle: ' + x.M + '\n';
      t += 'Siang : Kasir ' + x.SK + ', Piket ' + x.SP + '\n';
      if (x.off) t += 'Libur : ' + x.off + '\n';
    }
    return t;
  }
  function myText(i) {
    const e = computed()[i]; if (!e || !e.result) return '';
    const me = names()[state.me], start = weekStart(i), codes = e.result.assign[me];
    let t = 'JADWAL ' + me.toUpperCase() + ' · ' + range(start) + '\n\n';
    codes.forEach((c, d) => {
      const inf = info(c);
      t += S.DAYS[d] + ' ' + dm(S.addDays(start, d)) + ': ' + (inf.key === 'libur' ? 'Libur' : inf.sh + (inf.role ? ' · ' + inf.role : '') + ' (' + inf.time + ')') + '\n';
    });
    return t;
  }
  async function copyText(t, msg) {
    const ok = msg || 'Teks jadwal disalin.';
    try { await navigator.clipboard.writeText(t); flash(ok); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); flash(ok); } catch (_) { flash('Gagal menyalin.'); }
      ta.remove();
    }
  }
  async function shareText(title, text) {
    try {
      const sh = plugins().Share;
      if (!sh) throw new Error('no share');
      await sh.share({ title, text, dialogTitle: 'Bagikan jadwal' });
    } catch (e) {
      if (e && /cancel/i.test(String(e.message || e))) return;
      copyText(text);
    }
  }
  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  async function saveFile(fname, bytes, mime) {
    if (isNative) {
      const P = plugins();
      if (!P.Filesystem || !P.Share) { flash('Fitur simpan file belum tersedia di aplikasi ini.'); return; }
      try {
        const r = await P.Filesystem.writeFile({ path: fname, data: toBase64(bytes), directory: 'CACHE' });
        await P.Share.share({ title: fname, files: [r.uri], dialogTitle: 'Buka dengan WPS Office' });
      } catch (e) {
        if (!/cancel/i.test(String(e && e.message || e))) flash('Gagal mengekspor: ' + (e && e.message ? e.message : e));
      }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: mime })); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    flash('File ' + fname + ' diunduh. Buka dengan WPS Office atau Excel.');
  }
  function exportXlsx(i) {
    const m = sheetModel(i);
    if (!m) { flash('Jadwal minggu ini belum lengkap.'); return; }
    saveFile('Jadwal-Mixue-' + weekStart(i) + '.xlsx', X.buildWeekWorkbook(m), XLSX_MIME);
  }

  /* ---------- panduan singkat (guide tour) ---------- */
  const tour = { active: false, pending: false, i: 0, el: null };
  function viewerSteps(me) {
    return [
      { tab: 'me', title: 'Selamat datang, ' + me, text: 'Aplikasi ini menerima jadwal dari admin. Jadwal masuk dan diperbarui otomatis, kamu tidak perlu membuat apa pun.' },
      { tab: 'me', t: ['#nav .in'], title: 'Tiga menu utama', text: 'Jadwalku: shift kamu selama seminggu. Lengkap: jadwal semua orang dan ekspor ke WPS. Atur: sinkronisasi dan pengaturan.' },
      { tab: 'me', t: ['.weeknav'], title: 'Pindah minggu', text: 'Pakai panah ‹ › untuk melihat minggu sebelumnya atau berikutnya. Berlaku di semua menu.' },
      { tab: 'me', t: ['.hero', '.empty'], title: 'Jadwalmu', text: 'Lihat shift hari ini, tugas (Kasir atau Piket), dan jam kerjanya. Ketuk hari lain untuk melihat detailnya. Saat admin mengubah jadwal, tampilan ini ikut berubah sendiri.' },
      { tab: 'all', t: ['.sheetwrap', '.empty'], closest: '.card', title: 'Jadwal lengkap', text: 'Tabel semua orang dalam seminggu. Kolom putih = kasir, biru = piket, merah = libur.' },
      { tab: 'all', t: ['[data-action^="xlsx:"]'], title: 'Ekspor ke WPS', text: 'Simpan jadwal sebagai file Excel (.xlsx), lalu buka dengan WPS Office lewat menu bagikan.' },
      { tab: 'set', t: ['.sync-card'], title: 'Sinkronisasi', text: 'Jadwal dicek otomatis tiap menit saat aplikasi dibuka. Tekan Perbarui sekarang untuk cek manual.' },
      { tab: 'me', title: 'Siap dipakai!', text: 'Panduan ini bisa dibuka lagi kapan saja di Atur → Pengaturan → Lihat panduan.' },
    ];
  }
  function tourSteps() {
    const me = names()[state.me] || '';
    if (ROLE === 'viewer') return viewerSteps(me);
    return [
      { tab: 'me', title: 'Selamat datang, ' + me, text: 'Panduan singkat untuk mengenal menu dan cara membuat jadwal. Hanya sebentar.' },
      { tab: 'me', t: ['#nav .in'], title: 'Tiga menu utama', text: 'Jadwalku: shift kamu selama seminggu. Lengkap: jadwal kelima orang dan ekspor ke WPS. Atur: libur, request, dan pengaturan.' },
      { tab: 'set', t: ['.offlist'], title: '1. Pilih hari libur', text: 'Tentukan siapa yang libur tiap Senin–Jumat (setiap orang sekali). Sabtu dan Minggu semua masuk. Sistem menyusun Pagi, Siang, Middle, Kasir, dan Piket otomatis.' },
      { tab: 'set', t: ['[data-action^="auto:"]'], title: 'Isi libur otomatis', text: 'Malas memilih? Tekan tombol ini. Sistem mengisi libur sesuai aturan rolling dan jarak antar minggu.' },
      { tab: 'set', t: ['[data-action^="addreq:"]'], closest: '.card', title: 'Request masuk shift', text: 'Ingin masuk Pagi, Siang, atau Middle di hari tertentu? Tambahkan di sini. Dipenuhi selama tidak melanggar aturan, kalau tidak bisa akan diberi alasannya.' },
      { tab: 'set', t: ['[data-action="addweek"]'], title: 'Tambah minggu', text: 'Setelah satu minggu jadi, tambah minggu berikutnya. Hari liburnya disarankan otomatis agar bergilir.' },
      { tab: 'set', t: ['.sync-card'], title: 'Kirim ke Mixue Rakyat', text: 'Hubungkan sekali dengan token GitHub. Setelah itu setiap jadwal yang kamu buat otomatis dikirim ke aplikasi Mixue Rakyat. Bagikan kodenya ke 4 anggota lain.' },
      { tab: 'me', t: ['.weeknav'], title: 'Pindah minggu', text: 'Pakai panah ‹ › untuk melihat minggu sebelumnya atau berikutnya. Berlaku di semua menu.' },
      { tab: 'me', t: ['.hero', '.empty'], title: 'Jadwalmu', text: 'Setelah jadwal terisi, di sini tampil shift hari ini, tugas (Kasir atau Piket), dan jam kerjanya. Ketuk hari lain untuk melihat detailnya.' },
      { tab: 'all', t: ['.sheetwrap', '.empty'], closest: '.card', title: 'Jadwal lengkap', text: 'Tabel semua orang dalam seminggu. Kolom putih = kasir, biru = piket, merah = libur.' },
      { tab: 'all', t: ['[data-action^="xlsx:"]'], title: 'Ekspor ke WPS', text: 'Simpan jadwal sebagai file Excel (.xlsx), lalu buka dengan WPS Office lewat menu bagikan. Tombol ini muncul setelah jadwal minggu itu terisi.' },
      { tab: 'me', title: 'Siap dipakai!', text: 'Panduan ini bisa dibuka lagi kapan saja di Atur → Pengaturan → Lihat panduan.' },
    ];
  }
  function maybeTour() {
    if (tour.active || tour.pending || state.tourDone) return;
    if (!inMain()) return;
    tour.pending = true;
    const wait = () => {
      if (document.getElementById('splash')) { setTimeout(wait, 250); return; }
      setTimeout(() => {
        tour.pending = false;
        if (!state.tourDone && !tour.active && inMain()) startTour();
      }, 500);
    };
    wait();
  }
  function startTour() {
    if (tour.active) return;
    tour.active = true; tour.pending = false;
    const el = document.createElement('div');
    el.id = 'tour';
    el.innerHTML = '<div class="t-block"></div><div class="t-spot"></div><div class="t-card" role="dialog" aria-live="polite"></div>';
    document.body.appendChild(el);
    tour.el = el;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      const act = b.dataset.t, n = tourSteps().length;
      if (act === 'skip') endTour();
      else if (act === 'prev') tourShow(Math.max(0, tour.i - 1));
      else if (act === 'next') { if (tour.i >= n - 1) endTour(); else tourShow(tour.i + 1); }
    });
    window.addEventListener('resize', tourReflow);
    tourShow(0);
  }
  function endTour() {
    if (!tour.active) return;
    tour.active = false;
    window.removeEventListener('resize', tourReflow);
    if (tour.el) tour.el.remove();
    tour.el = null;
    state.tourDone = true; save();
    if (ui.tab !== 'me') go('me'); else render();
    window.scrollTo(0, 0);
  }
  function tourFind(st) {
    if (!st.t) return null;
    for (const sel of st.t) {
      let el = document.querySelector(sel);
      if (el && st.closest && el.closest(st.closest) && sel !== '.empty') el = el.closest(st.closest);
      if (el) return el;
    }
    return null;
  }
  function tourShow(i) {
    const steps = tourSteps();
    tour.i = i;
    const st = steps[i];
    const changed = ui.tab !== st.tab;
    if (changed) go(st.tab);
    const card = tour.el.querySelector('.t-card');
    card.style.opacity = '0';
    setTimeout(() => { if (tour.active && tour.i === i) tourPlace(); }, changed ? 340 : 40);
  }
  function tourReflow() { if (tour.active) tourPlace(true); }
  function tourPlace(quick) {
    const steps = tourSteps(), st = steps[tour.i], n = steps.length;
    const spot = tour.el.querySelector('.t-spot'), card = tour.el.querySelector('.t-card');
    let dots = '';
    for (let k = 0; k < n; k++) dots += '<i class="' + (k === tour.i ? 'on' : '') + '"></i>';
    card.innerHTML = '<div class="t-step">' + (tour.i + 1) + ' / ' + n + '</div><div class="t-title">' + esc(st.title) + '</div><div class="t-text">' + esc(st.text) + '</div>' +
      '<div class="t-dots">' + dots + '</div><div class="t-foot"><button class="ghost" data-t="skip">' + (tour.i === n - 1 ? '' : 'Lewati') + '</button>' +
      '<span>' + (tour.i > 0 ? '<button data-t="prev">Kembali</button> ' : '') + '<button class="primary" data-t="next">' + (tour.i === n - 1 ? 'Mulai' : 'Lanjut') + '</button></span></div>';
    const target = tourFind(st);
    const vw = window.innerWidth, vh = window.innerHeight;
    if (target) {
      if (!target.closest('#nav')) target.scrollIntoView({ block: 'center' });
      const r = target.getBoundingClientRect(), pad = 6;
      const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
      const w = Math.min(vw - 8, r.width + pad * 2) - Math.max(0, 4 - (r.left - pad));
      spot.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + (r.height + pad * 2) + 'px;';
      const ch = card.offsetHeight, below = vh - (y + r.height + pad * 2), above = y;
      let top;
      if (below >= ch + 18) top = y + r.height + pad * 2 + 12;
      else if (above >= ch + 18) top = y - ch - 12;
      else top = Math.max(12, vh - ch - 12);
      card.style.top = Math.max(12, Math.min(top, vh - ch - 12)) + 'px';
    } else {
      spot.style.cssText = 'left:' + (vw / 2) + 'px;top:' + (vh / 2) + 'px;width:0;height:0;';
      const ch = card.offsetHeight;
      card.style.top = Math.max(12, (vh - ch) / 2) + 'px';
    }
    card.style.opacity = '1';
  }

  /* ---------- sinkronisasi admin -> Rakyat ---------- */
  const SYNC_KEY = 'mixue-sch-sync';
  const SYNC_DEFAULT = { token: '', gistId: '', hash: '', at: 0, err: '' };
  let sync = (function () {
    try { const o = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); if (o && typeof o === 'object') return Object.assign({}, SYNC_DEFAULT, o); } catch (e) { /* abaikan */ }
    return Object.assign({}, SYNC_DEFAULT);
  })();
  function saveSync() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (e) { /* abaikan */ } }
  const hhmm = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
  const pub = { timer: 0, retry: 0, busy: false, again: false };

  function schedulePublish(delay) {
    if (ROLE !== 'admin' || !sync.token) return;
    clearTimeout(pub.timer);
    pub.timer = setTimeout(() => publishNow(false), delay == null ? 1200 : delay);
  }
  function adminSnapshot() {
    if (!namesValid() || state.me == null) return null;
    return Y.buildSnapshot({ admin: names()[state.me], people: names(), startDate: state.startDate, weeks: computed() });
  }
  async function publishNow(force) {
    if (ROLE !== 'admin' || !sync.token) return;
    const snap = adminSnapshot();
    if (!snap) return;
    const fp = Y.fingerprint(snap);
    if (!force && sync.gistId && fp === sync.hash && !sync.err) return;
    if (pub.busy) { pub.again = true; return; }
    pub.busy = true; clearTimeout(pub.retry); refreshSyncCard();
    try {
      const r = await Y.publish({ token: sync.token, gistId: sync.gistId, snapshot: snap });
      sync.gistId = r.id; sync.hash = fp; sync.at = Date.now(); sync.err = '';
    } catch (e) {
      sync.err = e.message || 'Gagal mengirim.';
      if (e.kind === 'notfound' && sync.gistId) { sync.gistId = ''; sync.err = 'Penyimpanan lama hilang, dibuat ulang. Bagikan kode baru ke anggota.'; pub.retry = setTimeout(() => publishNow(true), 800); }
      else if (e.kind !== 'auth') pub.retry = setTimeout(() => publishNow(true), 30000);
    } finally {
      pub.busy = false; saveSync(); refreshSyncCard();
      if (pub.again) { pub.again = false; schedulePublish(300); }
    }
  }
  function saveToken() {
    const t = String(ui.tokenDraft || '').trim();
    if (!/^(ghp_|github_pat_|gho_)[A-Za-z0-9_]{20,}$/.test(t)) {
      ui.tokenError = 'Token tidak dikenali. Salin token utuh dari GitHub (diawali ghp_).'; render(); return;
    }
    sync.token = t; sync.err = ''; ui.tokenDraft = ''; ui.tokenError = ''; saveSync(); render(); publishNow(true);
  }
  function syncStatusAdmin() {
    if (!sync.token) return ['off', 'Belum terhubung'];
    if (pub.busy) return ['busy', 'Mengirim jadwal…'];
    if (sync.err) return ['err', sync.err];
    if (sync.at) return ['ok', 'Terhubung · terakhir terkirim ' + hhmm(sync.at)];
    return ['busy', 'Menunggu pengiriman pertama…'];
  }
  function syncCardAdmin() {
    const st = syncStatusAdmin();
    let h = '<div class="card sync-card"><h2>Kirim ke Mixue Rakyat</h2><div class="sync-st ' + st[0] + '"><i class="sdot"></i><span>' + esc(st[1]) + '</span></div>';
    if (sync.token) {
      h += '<p class="muted small" style="margin:4px 0 0">Setiap perubahan jadwal otomatis dikirim ke aplikasi Mixue Rakyat.</p>';
      h += '<h3>Kode untuk anggota</h3>';
      if (sync.gistId) {
        h += '<div class="code">' + esc(sync.gistId) + '</div><div class="row" style="margin-top:10px"><button class="accent" data-action="' + (isNative ? 'sharecode' : 'copycode') + '">' + (isNative ? 'Bagikan kode' : 'Salin kode') + '</button>' +
          (isNative ? '<button data-action="copycode">Salin</button>' : '') + '</div>';
      } else h += '<p class="muted small" style="margin:0">Kode muncul setelah jadwal pertama terkirim.</p>';
      h += '<div class="row" style="margin-top:14px"><button data-action="syncnow">Kirim ulang sekarang</button><button class="ghost danger" data-action="disconnect">Putuskan</button></div>';
    } else {
      h += '<p class="muted small" style="margin:6px 0 8px">Supaya jadwal otomatis sampai ke Mixue Rakyat, hubungkan sekali ke akun GitHub-mu:</p>' +
        '<ol class="rules small"><li><a href="https://github.com/settings/tokens/new?scopes=gist&description=Mixue%20Penguasa" target="_blank" rel="noopener">Buat token GitHub</a>, login, lalu tekan <b>Generate token</b> (izin gist sudah terpilih).</li>' +
        '<li>Salin token yang muncul (diawali <b>ghp_</b>), tempel di bawah.</li></ol>' +
        '<input type="password" id="tokenInput" data-field="tokenDraft" placeholder="Tempel token di sini" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(ui.tokenDraft) + '" style="margin-top:8px">';
      if (ui.tokenError) h += '<div class="msg err" style="margin-top:8px">' + esc(ui.tokenError) + '</div>';
      h += '<div class="row" style="margin-top:10px"><button class="primary" data-action="savetoken">Simpan & hubungkan</button></div>';
    }
    return h + '</div>';
  }
  function refreshSyncCard() {
    if (ROLE === 'admin') {
      const el = document.querySelector('.sync-card');
      if (el && !(document.activeElement && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) el.outerHTML = syncCardAdmin();
    } else {
      const el = document.querySelector('.sync-card');
      if (el) el.outerHTML = syncCardViewer();
    }
  }

  /* ---------- penerimaan di Mixue Rakyat ---------- */
  const pull = { busy: false };
  function applySnapshot(snap) {
    state.snap = snap; state.people = snap.people.slice(); state.admin = snap.admin; state.startDate = snap.startDate;
    state.weeks = snap.weeks.map(() => newWeek()); state.syncAt = Date.now();
    const idx = state.meName ? state.people.indexOf(state.meName) : -1;
    state.me = idx >= 0 && state.people[idx] !== snap.admin ? idx : null;
    ui.sel = Math.max(0, Math.min(state.weeks.length - 1, ui.sel));
  }
  async function connectCode() {
    if (ui.codeBusy) return;
    const code = Y.parseCode(ui.codeDraft);
    if (!code) { ui.codeError = 'Kode tidak dikenali. Tempel kode dari admin.'; render(); return; }
    ui.codeBusy = true; ui.codeError = ''; render();
    try {
      const r = await Y.fetchSnapshot({ gistId: code, etag: '' });
      state.code = code; state.etag = r.etag; state.meName = ''; state.me = null;
      applySnapshot(r.snapshot); state.checkedAt = Date.now(); state.syncErr = '';
      ui.codeDraft = ''; ui.sel = currentWeekIndex(); save();
    } catch (e) { ui.codeError = e.message || 'Gagal terhubung.'; }
    ui.codeBusy = false; render();
  }
  async function pullNow(manual) {
    if (ROLE !== 'viewer' || !state.code || pull.busy) return;
    pull.busy = true;
    const prevErr = state.syncErr;
    let changed = !!manual;
    try {
      const r = await Y.fetchSnapshot({ gistId: state.code, etag: state.etag });
      state.checkedAt = Date.now(); state.syncErr = '';
      if (r.notModified) { if (manual) flash('Sudah yang terbaru.'); }
      else { applySnapshot(r.snapshot); state.etag = r.etag; changed = true; if (manual) flash('Jadwal diperbarui.'); }
    } catch (e) {
      state.syncErr = e.message || 'Gagal memperbarui.'; if (manual) flash(state.syncErr);
    }
    pull.busy = false; save();
    if (state.syncErr !== prevErr) changed = true;
    if (changed) { if (tour.active) { render(); tourReflow(); } else render(); }
  }
  function startPolling() {
    setInterval(() => { if (!document.hidden) pullNow(false); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pullNow(false); });
    window.addEventListener('online', () => pullNow(false));
    pullNow(false);
  }
  function syncCardViewer() {
    const ok = !state.syncErr;
    let h = '<div class="card sync-card"><h2>Sinkronisasi dengan admin</h2><div class="sync-st ' + (ok ? 'ok' : 'err') + '"><i class="sdot"></i><span>' +
      (ok ? 'Terhubung ke admin (' + esc(state.admin) + ')' : esc(state.syncErr)) + '</span></div>';
    h += '<p class="muted small" style="margin:4px 0 0">Jadwal diperbarui otomatis.' +
      (state.snap && state.snap.updatedAt ? ' Perubahan admin terakhir: ' + esc(hhmm(Date.parse(state.snap.updatedAt))) + '.' : '') +
      (state.checkedAt ? ' Dicek: ' + esc(hhmm(state.checkedAt)) + '.' : '') + '</p>';
    return h + '<div class="row" style="margin-top:12px"><button class="accent" data-action="pullnow">Perbarui sekarang</button></div></div>';
  }
  function viewCode() {
    let h = '<div class="onb"><div class="logo" aria-hidden="true">M</div><div><h1>Hubungkan ke admin</h1>' +
      '<p class="muted" style="margin:6px 0 0">Minta kode dari admin (aplikasi Mixue Penguasa → Atur → Kirim ke Mixue Rakyat), lalu tempel di sini. Cukup sekali.</p></div>' +
      '<input type="text" id="codeInput" data-field="codeDraft" placeholder="Tempel kode di sini" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(ui.codeDraft) + '"' + (ui.codeBusy ? ' disabled' : '') + '>';
    if (ui.codeError) h += '<div class="msg err">' + esc(ui.codeError) + '</div>';
    return h + '<button class="primary" data-action="connect" style="padding:12px"' + (ui.codeBusy ? ' disabled' : '') + '>' + (ui.codeBusy ? 'Menghubungkan…' : 'Hubungkan') + '</button></div>';
  }
  function viewSetViewer() {
    let h = '<div class="head"><div><h1>Atur</h1><div class="date">Sinkronisasi dan pengaturan</div></div></div>';
    h += syncCardViewer();
    const opts = names().map((n, i) => (n === state.admin ? '' : '<option value="' + i + '"' + (state.me === i ? ' selected' : '') + '>' + esc(n) + '</option>')).join('');
    h += '<details class="card"><summary>Pengaturan</summary><h3 style="margin-top:0">Aku adalah</h3><select data-field="me">' + opts + '</select>' +
      '<h3>Kode admin</h3><div class="code">' + esc(state.code) + '</div>' +
      '<div class="row" style="margin-top:14px"><button data-action="changecode">Ganti kode</button><button data-action="tour">Lihat panduan</button></div>' +
      '<div class="row" style="margin-top:10px"><button class="danger" data-action="reset">Keluar & hapus data</button></div></details>';
    return h;
  }

  /* ---------- event ---------- */
  $app.addEventListener('input', (e) => {
    const f = e.target.dataset && e.target.dataset.field;
    if (f === 'nameDraft') { ui.nameDraft = e.target.value; ui.nameError = ''; }
    else if (f && f.indexOf('pd:') === 0) { ui.peopleDraft[+f.slice(3)] = e.target.value; ui.nameError = ''; }
    else if (f === 'codeDraft') { ui.codeDraft = e.target.value; ui.codeError = ''; }
    else if (f === 'tokenDraft') { ui.tokenDraft = e.target.value; ui.tokenError = ''; }
  });
  $app.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'codeInput') { e.preventDefault(); connectCode(); }
    else if (e.target.id === 'tokenInput') { e.preventDefault(); saveToken(); }
    else if (e.target.id === 'nameInput') { e.preventDefault(); if (ROLE === 'admin' && !namesValid() && state.me == null) welcomeNext(); else submitName(); }
    else if (e.target.dataset && e.target.dataset.field && e.target.dataset.field.indexOf('pd:') === 0) {
      e.preventDefault();
      const next = $app.querySelector('[data-field="pd:' + (Number(e.target.dataset.field.slice(3)) + 1) + '"]');
      if (next) next.focus(); else savePeople();
    }
  });
  function welcomeNext() {
    const name = ui.nameDraft.trim();
    if (!name) { ui.nameError = 'Ketik namamu dulu.'; render(); return; }
    ui.myName = name; ui.nameError = ''; ui.step = 'people';
    // isi dari data yang sudah ada, pastikan namamu ikut tercantum
    const draft = state.people.map((x) => String(x).trim());
    if (!draft.some((x) => x.toLowerCase() === name.toLowerCase())) {
      const slot = draft.findIndex((x) => !x);
      draft[slot >= 0 ? slot : 0] = name;
    }
    ui.peopleDraft = draft;
    render(); window.scrollTo(0, 0);
  }
  function savePeople() {
    const list = ui.peopleDraft.map((x) => String(x).trim());
    const lower = list.map((x) => x.toLowerCase());
    let err = '';
    if (list.some((x) => !x)) err = 'Isi kelima nama dulu.';
    else if (new Set(lower).size !== 5) err = 'Ada nama yang sama. Setiap orang harus punya nama berbeda.';
    else if (lower.indexOf(ui.myName.toLowerCase()) < 0) err = 'Namamu “' + ui.myName + '” belum ada di daftar. Masukkan namamu sebagai salah satu dari 5 nama.';
    if (err) { ui.nameError = err; render(); return; }
    state.people = list;
    state.me = lower.indexOf(ui.myName.toLowerCase());
    state.weeks = [newWeek()];
    state.baseline = { prevOff: [null, null, null, null, null], prevMiddle: null };
    state.startDate = S.snapToMonday(todayISO());
    ui.nameDraft = ''; ui.nameError = ''; ui.tab = 'me'; ui.sel = 0; ui.selDay = null; ui.step = 'welcome';
    save(); render(); window.scrollTo(0, 0);
  }
  function submitName() {
    const v = ui.nameDraft.trim().toLowerCase();
    const i = names().findIndex((n) => n.toLowerCase() === v);
    if (i < 0) {
      ui.nameError = v ? 'Nama “' + ui.nameDraft.trim() + '” belum ada di daftar. Pilih salah satu di bawah' + (ROLE === 'viewer' ? ', atau minta admin menambahkan namamu.' : ', atau ubah daftar nama.') : 'Ketik namamu dulu.';
      render(); return;
    }
    if (ROLE === 'viewer' && names()[i] === state.admin) {
      ui.nameError = '“' + names()[i] + '” adalah admin. Admin memakai aplikasi Mixue Penguasa.';
      render(); return;
    }
    state.me = i; state.meName = names()[i]; ui.nameDraft = ''; ui.nameError = ''; ui.tab = 'me'; ui.selDay = null; ui.sel = currentWeekIndex();
    save(); render(); window.scrollTo(0, 0);
  }

  $app.addEventListener('change', (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.field;
    if (!f || f === 'nameDraft') return;
    const [kind, a, b] = f.split(':');
    const v = el.value;
    const idx = v === '' ? null : Number(v);
    switch (kind) {
      case 'name': state.people[+a] = v.trim(); break;
      case 'me': state.me = idx; state.meName = idx == null ? '' : names()[idx]; break;
      case 'start': if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { state.startDate = S.snapToMonday(v); ui.sel = currentWeekIndex(); } break;
      case 'gap': {
        const x = Math.max(1, Math.min(14, Math.round(Number(v)) || 1));
        state.settings[a] = x;
        if (state.settings.minGap > state.settings.maxGap) { if (a === 'minGap') state.settings.maxGap = x; else state.settings.minGap = x; }
        break;
      }
      case 'baseOff': state.baseline.prevOff[+a] = idx; break;
      case 'baseMid': state.baseline.prevMiddle = idx; break;
      case 'off': state.weeks[+a].off[+b] = idx; break;
      case 'mid': state.weeks[+a].middle = v === 'auto' || v === '' ? 'auto' : Number(v); break;
      case 'reqP': state.weeks[+a].requests[+b].p = Number(v); break;
      case 'reqD': state.weeks[+a].requests[+b].day = Number(v); break;
      case 'reqS': state.weeks[+a].requests[+b].shift = v; break;
      default: return;
    }
    save(); render();
  });

  const onClick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const [act, a, b] = btn.dataset.action.split(':');
    const i = Number(a);
    switch (act) {
      case 'tab': go(a); break;
      case 'tour': startTour(); break;
      case 'connect': connectCode(); break;
      case 'changecode':
        state.code = ''; state.snap = null; state.etag = ''; state.meName = ''; state.me = null; state.admin = '';
        state.people = ['', '', '', '', '']; state.weeks = [newWeek()]; ui.codeError = ''; save(); render(); window.scrollTo(0, 0);
        break;
      case 'pullnow': pullNow(true); break;
      case 'savetoken': saveToken(); break;
      case 'syncnow': publishNow(true); break;
      case 'disconnect':
        if (window.confirm('Putuskan sinkronisasi? Token dihapus dari aplikasi ini. Mixue Rakyat tidak menerima pembaruan lagi sampai kamu menghubungkan lagi.')) {
          sync.token = ''; sync.err = ''; saveSync(); render();
        }
        break;
      case 'copycode': copyText(sync.gistId, 'Kode disalin. Kirim ke anggota lain.'); break;
      case 'sharecode': shareText('Kode Mixue Rakyat', 'Kode Mixue Rakyat:\n' + sync.gistId + '\n\nBuka aplikasi Mixue Rakyat, lalu tempel kode ini.'); break;
      case 'gotoset': go('set'); break;
      case 'wk': ui.sel = Math.max(0, Math.min(state.weeks.length - 1, ui.sel + i)); ui.selDay = null; render(); break;
      case 'day': ui.selDay = i; render(); break;
      case 'chname': state.me = null; state.meName = ''; ui.nameDraft = ''; ui.nameError = ''; render(); window.scrollTo(0, 0); break;
      case 'pick': ui.nameDraft = names()[i]; submitName(); break;
      case 'welcomenext': welcomeNext(); break;
      case 'peopleback': ui.step = 'welcome'; ui.nameDraft = ui.myName; ui.nameError = ''; render(); break;
      case 'savepeople': savePeople(); break;
      case 'submitname': submitName(); break;
      case 'addweek': {
        state.weeks.push(newWeek());
        ui.sel = state.weeks.length - 1; ui.selDay = null;
        if (namesValid()) applySuggestion(ui.sel);
        save(); render(); window.scrollTo(0, 0);
        break;
      }
      case 'remove':
        if (state.weeks.length > 1) { state.weeks.pop(); ui.sel = Math.min(ui.sel, state.weeks.length - 1); save(); render(); }
        break;
      case 'auto': if (applySuggestion(i)) { save(); render(); } break;
      case 'clear': state.weeks[i].off = [null, null, null, null, null]; save(); render(); break;
      case 'addreq': state.weeks[i].requests.push({ p: 0, day: 0, shift: 'Pagi' }); save(); render(); break;
      case 'delreq': state.weeks[i].requests.splice(Number(b), 1); save(); render(); break;
      case 'copy': copyText(weekText(i)); break;
      case 'share': shareText('Jadwal Mixue Sch', weekText(i)); break;
      case 'sharemy': if (isNative) shareText('Jadwal ' + names()[state.me], myText(i)); else copyText(myText(i)); break;
      case 'xlsx': exportXlsx(i); break;
      case 'reset':
        if (window.confirm('Hapus semua data jadwal dan kembali ke awal?')) { state = defaultState(); ui.sel = 0; ui.selDay = null; ui.tab = 'me'; ui.step = 'welcome'; ui.nameDraft = ''; ui.nameError = ''; ui.myName = ''; save(); render(); window.scrollTo(0, 0); }
        break;
      default: break;
    }
  };
  $app.addEventListener('click', onClick);
  $nav.addEventListener('click', onClick);

  render();
  if (ROLE === 'viewer') startPolling();
  else {
    schedulePublish(2500);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedulePublish(500); });
    window.addEventListener('online', () => schedulePublish(500));
  }
})();
