(function () {
  'use strict';
  const S = window.Scheduler;
  const KEY = 'mixue-sch-v1';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const SHIFTS = ['Pagi', 'Siang', 'Middle'];
  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');

  /* ---------- mode aplikasi Android (Capacitor) ---------- */
  const isNative = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  if (isNative) document.documentElement.classList.add('native');
  async function nativeShare(title, text) {
    try {
      const sharePlugin = window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
      if (!sharePlugin) throw new Error('no share');
      await sharePlugin.share({ title, text, dialogTitle: 'Bagikan jadwal' });
    } catch (e) {
      if (e && /cancel/i.test(String(e.message || e))) return;
      copyText(text);
    }
  }

  /* ---------- util ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function todayISO() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dmy(iso) { const d = S.parseDate(iso); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function dm(iso) { const d = S.parseDate(iso); return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1); }
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

  /* ---------- state ---------- */
  function newWeek() { return { off: [null, null, null, null, null], middle: 'auto', requests: [] }; }
  function defaultState() {
    return {
      version: 1,
      people: ['Ahmad', 'Ferri', 'Budi', 'Tamam', 'Ainun'],
      settings: { minGap: S.DEFAULT_SETTINGS.minGap, maxGap: S.DEFAULT_SETTINGS.maxGap },
      baseline: { prevOff: [null, null, null, null, null], prevMiddle: null },
      startDate: S.nextMonday(todayISO()),
      weeks: [newWeek()],
    };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.version === 1 && Array.isArray(s.people) && s.people.length === 5 && Array.isArray(s.weeks) && s.weeks.length) return s;
    } catch (e) { /* abaikan */ }
    return defaultState();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* abaikan */ } }
  let state = load();

  const names = () => state.people.map((n) => String(n).trim());
  function namesValid() { const n = names(); return n.every(Boolean) && new Set(n).size === 5; }

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

  /* ---------- render ---------- */
  function optionTags(selected, blank) {
    const n = names();
    let h = blank == null ? '' : '<option value="">' + esc(blank) + '</option>';
    n.forEach((name, i) => { h += '<option value="' + i + '"' + (selected === i ? ' selected' : '') + '>' + esc(name || ('Orang ' + (i + 1))) + '</option>'; });
    return h;
  }

  function cellHtml(code) {
    const shift = S.shiftOf(code), role = S.roleOf(code);
    const cls = shift === 'Pagi' ? 'c-P' : shift === 'Siang' ? 'c-S' : shift === 'Middle' ? 'c-M' : 'c-L';
    return '<td class="cell ' + cls + '">' + shift + (role ? '<small>' + role + '</small>' : '') + '</td>';
  }

  function renderWeek(i, entry) {
    const w = state.weeks[i];
    const start = S.addDays(state.startDate, i * 7);
    const res = entry.result;
    const last = i === state.weeks.length - 1;
    let h = '<section class="card" id="week-' + i + '">';
    h += '<div class="week-head"><h2>Minggu ' + (i + 1) + ' · ' + esc(range(start)) + '</h2>';
    if (res) h += '<span class="badge">Middle Sab–Min: ' + esc(res.middle) + '</span>';
    h += '</div>';

    // input libur
    h += '<div class="no-print"><div class="tablewrap"><table aria-label="Input hari libur"><thead><tr><th></th>';
    for (let d = 0; d < 7; d++) h += '<th>' + S.DAYS[d] + '<br><span class="small">' + dm(S.addDays(start, d)) + '</span></th>';
    h += '</tr></thead><tbody><tr><td class="rowhead">Libur</td>';
    for (let d = 0; d < 5; d++) {
      h += '<td class="sel"><select data-field="off:' + i + ':' + d + '" aria-label="Libur hari ' + S.DAYS[d] + '">' + optionTags(w.off[d], '— pilih —') + '</select></td>';
    }
    h += '<td class="weekend">wajib masuk</td><td class="weekend">wajib masuk</td></tr></tbody></table></div>';

    h += '<div class="row" style="margin-top:10px">';
    h += '<label class="field" style="grid-auto-flow:column;align-items:center;gap:8px">Middle<select data-field="mid:' + i + '" aria-label="Middle minggu ini">' +
      '<option value="auto"' + (w.middle === 'auto' ? ' selected' : '') + '>Otomatis (rotasi)</option>' + optionTags(w.middle === 'auto' ? null : w.middle) + '</select></label>';
    h += '<button data-action="auto:' + i + '" class="primary">✨ Isi libur otomatis</button>';
    h += '<button data-action="clear:' + i + '" class="ghost">Kosongkan</button>';
    if (last && state.weeks.length > 1) h += '<button data-action="remove:' + i + '" class="danger ghost">Hapus minggu ini</button>';
    h += '</div>';

    // request
    h += '<h3>Request masuk shift</h3>';
    const rejected = {};
    if (res) res.rejected.forEach((r) => { rejected[r.request.i] = r.reason; });
    w.requests.forEach((r, ri) => {
      h += '<div class="reqrow"><select data-field="reqP:' + i + ':' + ri + '" aria-label="Nama">' + optionTags(r.p) + '</select>';
      h += '<select data-field="reqD:' + i + ':' + ri + '" aria-label="Hari">';
      S.DAYS.forEach((dn, d) => { h += '<option value="' + d + '"' + (r.day === d ? ' selected' : '') + '>' + dn + '</option>'; });
      h += '</select><select data-field="reqS:' + i + ':' + ri + '" aria-label="Shift">';
      SHIFTS.forEach((s) => { h += '<option' + (r.shift === s ? ' selected' : '') + '>' + s + '</option>'; });
      h += '</select><button class="ghost" data-action="delreq:' + i + ':' + ri + '" aria-label="Hapus request">×</button>';
      if (res) {
        if (rejected[ri] !== undefined) h += '<span class="status no">✗ ' + esc(rejected[ri]) + '</span>';
        else h += '<span class="status ok">✓ dipenuhi</span>';
      }
      h += '</div>';
    });
    h += '<button data-action="addreq:' + i + '">+ Tambah request</button>';
    h += '</div>'; // no-print

    // pesan
    const msgs = [];
    entry.errors.forEach((m) => msgs.push('<div class="msg err">' + esc(m) + '</div>'));
    entry.warnings.forEach((m) => msgs.push('<div class="msg warn">⚠ ' + esc(m) + '</div>'));
    entry.notes.forEach((m) => msgs.push('<div class="msg info">' + esc(m) + '</div>'));
    if (msgs.length) h += '<div class="msgs no-print">' + msgs.join('') + '</div>';

    if (res) {
      // per posisi
      h += '<h3>Jadwal per posisi</h3><div class="tablewrap"><table><thead><tr><th></th>';
      for (let d = 0; d < 7; d++) h += '<th>' + S.DAYS_SHORT[d] + '<br><span class="small">' + dm(S.addDays(start, d)) + '</span></th>';
      h += '</tr></thead><tbody>';
      const rows = [['PK', 'Pagi · Kasir', 'c-P'], ['PP', 'Pagi · Piket', 'c-P'], ['M', 'Middle', 'c-M'], ['SK', 'Siang · Kasir', 'c-S'], ['SP', 'Siang · Piket', 'c-S'], ['off', 'Libur', 'c-L']];
      rows.forEach(([key, label, cls]) => {
        h += '<tr><td class="slot-name">' + label + '</td>';
        for (let d = 0; d < 7; d++) {
          const v = res.days[d][key];
          h += v ? '<td class="' + cls + '">' + esc(v) + '</td>' : '<td class="c-none">—</td>';
        }
        h += '</tr>';
      });
      h += '</tbody></table></div>';

      // per orang
      h += '<h3>Jadwal per orang</h3><div class="tablewrap"><table><thead><tr><th></th>';
      for (let d = 0; d < 7; d++) h += '<th>' + S.DAYS_SHORT[d] + '</th>';
      h += '</tr></thead><tbody>';
      names().forEach((n) => {
        h += '<tr><td class="rowhead">' + esc(n) + '</td>';
        res.assign[n].forEach((c) => { h += cellHtml(c); });
        h += '</tr>';
      });
      h += '</tbody></table></div>';

      // rekap
      h += '<div class="stats"><h3>Rekap jatah minggu ini</h3><div class="tablewrap"><table><thead><tr><th></th><th>Pagi</th><th>Siang</th><th>Middle</th><th>Kasir</th><th>Piket</th></tr></thead><tbody>';
      names().forEach((n) => {
        const s = res.stats[n];
        h += '<tr><td class="rowhead">' + esc(n) + '</td><td>' + s.Pagi + '</td><td>' + s.Siang + '</td><td>' + s.Middle + '</td><td>' + s.Kasir + '</td><td>' + s.Piket + '</td></tr>';
      });
      h += '</tbody></table></div></div>';

      if (entry.nextMondayOff) {
        h += '<p class="muted small">Minggu kasir pagi: <b>' + esc(entry.nextMondayOff) + '</b> (libur Senin minggu depan).</p>';
      } else {
        h += '<p class="muted small no-print">Minggu depan belum dibuat, jadi kasir pagi hari Minggu masih bebas dan akan menyesuaikan siapa yang libur Senin depan.</p>';
      }
      h += '<div class="row no-print" style="margin-top:8px"><button data-action="copy:' + i + '">📋 Salin teks</button>' +
        (isNative
          ? '<button class="primary" data-action="share:' + i + '">📤 Bagikan (WhatsApp, dll)</button>'
          : '<button data-action="csv:' + i + '">⬇ Unduh CSV</button><button data-action="print">🖨 Cetak</button>') + '</div>';
    }
    h += '</section>';
    return h;
  }

  function renderSettings() {
    const n = state.people;
    let h = '<details class="card no-print"><summary>Pengaturan: nama, aturan jarak libur, minggu sebelumnya</summary>';
    h += '<h3>Nama 5 orang</h3><div class="grid5">';
    n.forEach((name, i) => { h += '<label class="field">Orang ' + (i + 1) + '<input type="text" data-field="name:' + i + '" value="' + esc(name) + '" maxlength="30"></label>'; });
    h += '</div>';
    h += '<h3>Tanggal minggu pertama</h3><label class="field" style="max-width:220px">Mulai (otomatis dibulatkan ke hari Senin)' +
      '<input type="date" data-field="start" value="' + esc(state.startDate) + '"></label>';
    h += '<h3>Jarak antar libur (hari)</h3><div class="row"><label class="field">Minimal (terlalu dekat)<input type="number" min="1" max="14" data-field="gap:minGap" value="' + state.settings.minGap + '"></label>' +
      '<label class="field">Maksimal (terlalu jauh)<input type="number" min="1" max="14" data-field="gap:maxGap" value="' + state.settings.maxGap + '"></label></div>';
    h += '<p class="muted small">Bawaan 4–9 hari: Jumat → Senin (3 hari) terlalu dekat; Senin → Kamis/Jumat (10–11 hari) terlalu jauh.</p>';
    h += '<h3>Minggu sebelumnya (opsional)</h3><p class="muted small">Isi bila jadwal sudah berjalan, supaya jarak libur dan rotasi Middle minggu pertama ikut diperhitungkan.</p>';
    h += '<div class="grid5">';
    for (let d = 0; d < 5; d++) h += '<label class="field">Libur ' + S.DAYS[d] + '<select data-field="baseOff:' + d + '">' + optionTags(state.baseline.prevOff[d], '—') + '</select></label>';
    h += '<label class="field">Middle minggu lalu<select data-field="baseMid">' + optionTags(state.baseline.prevMiddle, '—') + '</select></label></div>';
    h += '<div class="row" style="margin-top:14px"><button class="danger" data-action="reset">Reset semua data</button></div>';
    h += '</details>';
    return h;
  }

  function renderRules() {
    return '<details class="card no-print"><summary>Aturan yang dipakai sistem</summary><ul class="rules">' +
      '<li>Tiap orang libur 1x seminggu, hanya Senin–Jumat (Sabtu & Minggu dilarang libur). Tiap hari kerja tepat 1 orang libur.</li>' +
      '<li>Senin–Jumat: Pagi (Kasir + Piket) dan Siang (Kasir + Piket). Sabtu–Minggu: Pagi (Kasir + Piket), Middle, Siang (Kasir + Piket).</li>' +
      '<li>Middle Sabtu & Minggu orang yang sama dan dirotasi tiap minggu.</li>' +
      '<li>Sehari sebelum libur wajib Pagi (Kasir), sehari setelah libur wajib Siang (Kasir).</li>' +
      '<li>Rolling antar minggu: yang kasir pagi hari Minggu = yang libur Senin berikutnya.</li>' +
      '<li>Jatah per minggu: yang dapat Middle 2x Pagi + 2x Siang, lainnya 3x Pagi + 3x Siang.</li>' +
      '<li>Jarak libur minggu ini dan minggu depan tidak boleh terlalu jauh atau terlalu dekat.</li>' +
      '<li>Request shift dipenuhi selama tidak melanggar aturan di atas; yang tidak bisa akan diberi alasan.</li>' +
      '</ul></details>';
  }

  function render() {
    const open = {};
    document.querySelectorAll('details.card').forEach((d, i) => { open[i] = d.open; });
    let h = '<div class="topbar"><div class="brand"><div class="logo" aria-hidden="true">M</div><div><h1>Mixue Sch</h1>' +
      '<div class="sub">Penjadwal shift otomatis · 5 orang · Pagi, Siang, Middle</div></div></div>' +
      '<div class="row no-print"><button class="primary" data-action="addweek">+ Tambah minggu</button>' +
      (isNative ? '' : '<button data-action="print">🖨 Cetak</button>') + '</div></div>';
    h += '<p class="muted no-print">Pilih siapa yang libur di tiap hari (Senin–Jumat), sistem menyusun sisanya otomatis. Atau tekan “Isi libur otomatis”.</p>';
    if (!namesValid()) {
      h += '<div class="msg err">Nama kelima orang harus terisi dan tidak boleh sama. Perbaiki di bagian Pengaturan.</div>';
      h += renderSettings();
    } else {
      const all = S.computeAll(engineState());
      h += renderSettings() + renderRules();
      all.forEach((entry, i) => { h += renderWeek(i, entry); });
      h += '<div class="no-print"><button class="primary" data-action="addweek">+ Tambah minggu berikutnya</button></div>';
    }
    $app.innerHTML = h;
    document.querySelectorAll('details.card').forEach((d, i) => { if (open[i]) d.open = true; });
  }

  /* ---------- ekspor ---------- */
  function weekResult(i) {
    const all = S.computeAll(engineState());
    return all[i] && all[i].result ? all[i] : null;
  }
  function weekText(i) {
    const e = weekResult(i); if (!e) return '';
    const res = e.result, start = S.addDays(state.startDate, i * 7);
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
  function weekCsv(i) {
    const e = weekResult(i); if (!e) return '';
    const start = S.addDays(state.startDate, i * 7);
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const head = ['Nama'].concat(S.DAYS.map((dn, d) => dn + ' ' + dm(S.addDays(start, d))));
    const lines = [head.map(q).join(',')];
    names().forEach((n) => {
      lines.push([n].concat(e.result.assign[n].map((c) => (S.roleOf(c) ? S.shiftOf(c) + ' ' + S.roleOf(c) : S.shiftOf(c)))).map(q).join(','));
    });
    return lines.join('\r\n');
  }
  function download(name, text, type) {
    const blob = new Blob(['﻿' + text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); flash('Teks jadwal disalin.'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); flash('Teks jadwal disalin.'); } catch (_) { flash('Gagal menyalin.'); }
      ta.remove();
    }
  }

  /* ---------- event ---------- */
  $app.addEventListener('change', (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.field;
    if (!f) return;
    const [kind, a, b] = f.split(':');
    const v = el.value;
    const idx = v === '' ? null : Number(v);
    switch (kind) {
      case 'name': state.people[+a] = v.trim(); break;
      case 'start': if (/^\d{4}-\d{2}-\d{2}$/.test(v)) state.startDate = S.snapToMonday(v); break;
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

  $app.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const [act, a, b] = btn.dataset.action.split(':');
    const i = Number(a);
    switch (act) {
      case 'addweek': {
        state.weeks.push(newWeek());
        const w = state.weeks.length - 1;
        if (namesValid()) applySuggestion(w);
        save(); render();
        const el = document.getElementById('week-' + w); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'remove': if (state.weeks.length > 1) { state.weeks.pop(); save(); render(); } break;
      case 'auto': if (applySuggestion(i)) { save(); render(); } break;
      case 'clear': state.weeks[i].off = [null, null, null, null, null]; save(); render(); break;
      case 'addreq': state.weeks[i].requests.push({ p: 0, day: 0, shift: 'Pagi' }); save(); render(); break;
      case 'delreq': state.weeks[i].requests.splice(Number(b), 1); save(); render(); break;
      case 'copy': copyText(weekText(i)); break;
      case 'share': nativeShare('Jadwal Mixue Sch', weekText(i)); break;
      case 'csv': download('jadwal-' + S.addDays(state.startDate, i * 7) + '.csv', weekCsv(i), 'text/csv;charset=utf-8'); break;
      case 'print': window.print(); break;
      case 'reset':
        if (window.confirm('Hapus semua data jadwal dan kembali ke awal?')) { state = defaultState(); save(); render(); }
        break;
      default: break;
    }
  });

  render();
})();
