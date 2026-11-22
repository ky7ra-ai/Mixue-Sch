'use strict';
/*
 * MixueSync - sinkronisasi jadwal antara Mixue Penguasa (admin) dan Mixue Rakyat (penerima).
 * Penyimpanan bersama: satu GitHub Gist rahasia berisi schedule.json.
 *  - Admin menulis (butuh token GitHub dengan izin "gist").
 *  - Rakyat hanya membaca lewat kode (id gist), tanpa token. Pembaruan memakai ETag sehingga
 *    pengecekan berulang (304) tidak menghabiskan batas permintaan GitHub.
 * Modul ini tidak menyentuh DOM, jadi bisa diuji di Node dengan fetch palsu.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MixueSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const API = 'https://api.github.com';
  const FILE = 'schedule.json';
  const VERSION = 1;

  class SyncError extends Error {
    constructor(message, status, kind) { super(message); this.name = 'SyncError'; this.status = status || 0; this.kind = kind || 'error'; }
  }

  const SHIFT = { PK: 'Pagi', PP: 'Pagi', SK: 'Siang', SP: 'Siang', M: 'Middle', L: 'Libur' };
  const ROLE = { PK: 'Kasir', SK: 'Kasir', PP: 'Piket', SP: 'Piket' };
  const CODES = Object.keys(SHIFT);

  /* ---------- kode sambung ---------- */
  // Terima id gist polos, atau URL gist yang ditempel. Kembalikan id huruf kecil atau null.
  function parseCode(input) {
    const m = String(input == null ? '' : input).trim().match(/[0-9a-f]{20,40}/i);
    return m ? m[0].toLowerCase() : null;
  }

  /* ---------- isi data ---------- */
  // Dari assign (nama -> 7 kode) susun ulang days & stats persis seperti hasil penjadwal.
  function deriveResult(people, assign, middle) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const o = { off: null, PK: null, PP: null, SK: null, SP: null, M: null };
      people.forEach((n) => {
        const c = assign[n][d];
        if (c === 'L') o.off = n; else o[c] = n;
      });
      days.push(o);
    }
    const stats = {};
    people.forEach((n) => {
      const s = { Pagi: 0, Siang: 0, Middle: 0, Kasir: 0, Piket: 0, Libur: 0 };
      assign[n].forEach((c) => { s[SHIFT[c]]++; if (ROLE[c] === 'Kasir') s.Kasir++; if (ROLE[c] === 'Piket') s.Piket++; });
      stats[n] = s;
    });
    return { middle, assign, days, stats };
  }

  /*
   * weeks: [{result:{middle, assign}} | null]  (null = minggu belum lengkap)
   * Hanya assign + middle yang dikirim; sisanya diturunkan di penerima.
   */
  function buildSnapshot(o) {
    return {
      v: VERSION,
      app: 'mixue-sch',
      updatedAt: o.updatedAt || new Date().toISOString(),
      admin: o.admin,
      people: o.people.slice(),
      startDate: o.startDate,
      weeks: o.weeks.map((w) => (w && w.result ? { middle: w.result.middle, assign: w.result.assign } : null)),
    };
  }
  // Teks stabil tanpa updatedAt, untuk mendeteksi "tidak ada perubahan".
  function fingerprint(snap) {
    return JSON.stringify([snap.v, snap.admin, snap.people, snap.startDate, snap.weeks]);
  }
  function validate(s) {
    const bad = (m) => { throw new SyncError('Data jadwal tidak valid: ' + m, 0, 'invalid'); };
    if (!s || typeof s !== 'object' || s.app !== 'mixue-sch') bad('bukan jadwal Mixue');
    if (s.v !== VERSION) throw new SyncError('Versi data tidak cocok. Perbarui aplikasi Mixue Rakyat.', 0, 'version');
    if (!Array.isArray(s.people) || s.people.length !== 5 || s.people.some((n) => typeof n !== 'string' || !n)) bad('daftar nama');
    if (typeof s.admin !== 'string' || s.people.indexOf(s.admin) < 0) bad('admin');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.startDate)) bad('tanggal');
    if (!Array.isArray(s.weeks)) bad('minggu');
    s.weeks.forEach((w) => {
      if (w === null) return;
      if (!w.assign || s.people.indexOf(w.middle) < 0) bad('minggu rusak');
      s.people.forEach((n) => {
        if (!Array.isArray(w.assign[n]) || w.assign[n].length !== 7 || w.assign[n].some((c) => CODES.indexOf(c) < 0)) bad('kode shift');
      });
    });
    return s;
  }
  // Ubah snapshot jadi entri seperti hasil computeAll (hanya yang dipakai tampilan).
  function toEntries(snap) {
    return snap.weeks.map((w) => ({
      result: w ? Object.assign(deriveResult(snap.people, w.assign, w.middle), { rejected: [], notes: [] }) : null,
      errors: [], warnings: [], notes: [], nextMondayOff: null,
    }));
  }

  /* ---------- HTTP ---------- */
  function headers(token, etag, json) {
    const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) h.Authorization = 'Bearer ' + token;
    if (etag) h['If-None-Match'] = etag;
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  function httpError(status, what) {
    if (status === 401) return new SyncError('Token ditolak GitHub. Buat token baru lalu tempel lagi.', 401, 'auth');
    if (status === 403 || status === 429) return new SyncError('GitHub membatasi akses sementara atau izin token kurang. Coba lagi nanti.', status, 'limit');
    if (status === 404) return new SyncError(what === 'read' ? 'Kode tidak ditemukan. Periksa kembali kodenya.' : 'Gist tidak ditemukan. Pastikan token punya izin "gist".', 404, 'notfound');
    return new SyncError('GitHub membalas error ' + status + '.', status, 'http');
  }
  async function call(fetchImpl, url, opts, what) {
    let res;
    try { res = await fetchImpl(url, opts); } catch (e) { throw new SyncError('Tidak ada koneksi internet.', 0, 'network'); }
    if (res.status === 304) return res;
    if (!res.ok) throw httpError(res.status, what);
    return res;
  }

  // Admin: buat gist (tanpa gistId) atau perbarui. Kembalikan {id}.
  async function publish(o) {
    const f = o.fetchImpl || fetch;
    const content = JSON.stringify(o.snapshot);
    if (!o.token) throw new SyncError('Belum ada token.', 0, 'auth');
    if (!o.gistId) {
      const res = await call(f, API + '/gists', {
        method: 'POST', headers: headers(o.token, null, true), cache: 'no-store',
        body: JSON.stringify({ description: 'Mixue Sch - jadwal (jangan dihapus)', public: false, files: { [FILE]: { content } } }),
      }, 'write');
      const j = await res.json();
      if (!j || !j.id) throw new SyncError('Balasan GitHub tidak lengkap.', 0, 'http');
      return { id: j.id };
    }
    const res = await call(f, API + '/gists/' + o.gistId, {
      method: 'PATCH', headers: headers(o.token, null, true), cache: 'no-store',
      body: JSON.stringify({ files: { [FILE]: { content } } }),
    }, 'write');
    const j = await res.json();
    return { id: (j && j.id) || o.gistId };
  }

  // Rakyat: baca. Kembalikan {notModified:true} atau {snapshot, etag}.
  async function fetchSnapshot(o) {
    const f = o.fetchImpl || fetch;
    const res = await call(f, API + '/gists/' + o.gistId, { headers: headers(null, o.etag, false), cache: 'no-store' }, 'read');
    if (res.status === 304) return { notModified: true };
    const j = await res.json();
    const file = j && j.files && j.files[FILE];
    if (!file) throw new SyncError('Kode ini bukan jadwal Mixue.', 0, 'invalid');
    let text = file.content;
    if (file.truncated || typeof text !== 'string') {
      const raw = await call(f, file.raw_url, { cache: 'no-store' }, 'read');
      text = await raw.text();
    }
    let snap;
    try { snap = JSON.parse(text); } catch (e) { throw new SyncError('Data jadwal rusak.', 0, 'invalid'); }
    validate(snap);
    return { snapshot: snap, etag: (res.headers && res.headers.get && res.headers.get('ETag')) || '' };
  }

  return { FILE, VERSION, SyncError, parseCode, deriveResult, buildSnapshot, fingerprint, validate, toEntries, publish, fetchSnapshot };
});
