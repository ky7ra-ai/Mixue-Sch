'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../js/scheduler.js');
const Y = require('../js/sync.js');

const PEOPLE = ['Ferri', 'Deny', 'Mifta', 'Tama', 'Ahmad'];

function perms(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => perms(arr.slice(0, i).concat(arr.slice(i + 1))).map((p) => [x].concat(p)));
}

// GitHub palsu: meniru POST/PATCH/GET gist, ETag, 304, 401, 404.
function fakeGithub(validToken) {
  const gists = {};
  let n = 0;
  const calls = [];
  const resp = (status, body, extra) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => (extra && extra[k.toLowerCase()]) || null },
    json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const fetchImpl = async (url, opts) => {
    opts = opts || {};
    const method = opts.method || 'GET';
    calls.push({ url, method, headers: opts.headers || {} });
    const h = opts.headers || {};
    const m = url.match(/^https:\/\/api\.github\.com\/gists(?:\/([0-9a-f]+))?$/);
    if (!m) throw new Error('URL tak dikenal ' + url);
    if (method !== 'GET' && h.Authorization !== 'Bearer ' + validToken) return resp(401, { message: 'Bad credentials' });
    if (method === 'POST') {
      const body = JSON.parse(opts.body);
      const id = ('a1b2c3d4e5f60718293a4b5c6d7e8f9' + (++n)).slice(-32);
      gists[id] = { files: body.files, v: 1, public: body.public };
      return resp(201, { id });
    }
    const g = gists[m[1]];
    if (!g) return resp(404, { message: 'Not Found' });
    if (method === 'PATCH') {
      const body = JSON.parse(opts.body);
      Object.assign(g.files, body.files); g.v++;
      return resp(200, { id: m[1] });
    }
    const etag = '"v' + g.v + '"';
    if (h['If-None-Match'] === etag) return resp(304, null, { etag });
    const files = {};
    Object.keys(g.files).forEach((k) => { files[k] = { filename: k, content: g.files[k].content, truncated: false }; });
    return resp(200, { id: m[1], files }, { etag });
  };
  return { fetchImpl, gists, calls };
}

function weekResult(off, nextMonday) {
  const r = S.solveWeek({ people: PEOPLE, off, nextMondayOff: nextMonday || null, middleHistory: [], requests: [] });
  assert.ok(r.ok, r.error);
  return r;
}

test('parseCode: id polos, URL gist, spasi, huruf besar, ngawur', () => {
  const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f91';
  assert.strictEqual(Y.parseCode(id), id);
  assert.strictEqual(Y.parseCode('  ' + id.toUpperCase() + '\n'), id);
  assert.strictEqual(Y.parseCode('https://gist.github.com/ferri/' + id), id);
  assert.strictEqual(Y.parseCode('halo'), null);
  assert.strictEqual(Y.parseCode(''), null);
  assert.strictEqual(Y.parseCode(null), null);
});

test('deriveResult dari assign sama persis dengan hasil penjadwal (semua 120 libur)', () => {
  for (const off of perms(PEOPLE)) {
    const r = weekResult(off);
    const d = Y.deriveResult(PEOPLE, r.assign, r.middle);
    assert.deepStrictEqual(d.days, r.days, off.join());
    assert.deepStrictEqual(d.stats, r.stats, off.join());
    assert.strictEqual(d.middle, r.middle);
  }
});

test('snapshot: bangun, validasi, jadi entri tampilan, sidik jari', () => {
  const r1 = weekResult(PEOPLE, null);
  const weeks = [{ result: r1 }, null];
  const snap = Y.buildSnapshot({ admin: 'Ferri', people: PEOPLE, startDate: '2026-11-16', weeks, updatedAt: '2026-11-22T10:00:00Z' });
  assert.doesNotThrow(() => Y.validate(JSON.parse(JSON.stringify(snap))));
  const entries = Y.toEntries(JSON.parse(JSON.stringify(snap)));
  assert.strictEqual(entries.length, 2);
  assert.deepStrictEqual(entries[0].result.days, r1.days);
  assert.deepStrictEqual(entries[0].result.assign, r1.assign);
  assert.strictEqual(entries[1].result, null);
  // sidik jari tidak terpengaruh updatedAt, tapi berubah saat isi berubah
  const again = Y.buildSnapshot({ admin: 'Ferri', people: PEOPLE, startDate: '2026-11-16', weeks, updatedAt: '2030-01-01T00:00:00Z' });
  assert.strictEqual(Y.fingerprint(snap), Y.fingerprint(again));
  const r2 = weekResult(['Deny', 'Ferri', 'Mifta', 'Tama', 'Ahmad']);
  const changed = Y.buildSnapshot({ admin: 'Ferri', people: PEOPLE, startDate: '2026-11-16', weeks: [{ result: r2 }, null] });
  assert.notStrictEqual(Y.fingerprint(snap), Y.fingerprint(changed));
});

test('validate menolak data rusak atau versi lain', () => {
  const r = weekResult(PEOPLE);
  const ok = () => JSON.parse(JSON.stringify(Y.buildSnapshot({ admin: 'Ferri', people: PEOPLE, startDate: '2026-11-16', weeks: [{ result: r }] })));
  let s = ok(); s.v = 2; assert.throws(() => Y.validate(s), /Versi/);
  s = ok(); s.app = 'lain'; assert.throws(() => Y.validate(s), /tidak valid/);
  s = ok(); s.admin = 'Orang Asing'; assert.throws(() => Y.validate(s), /tidak valid/);
  s = ok(); s.people = ['A', 'B']; assert.throws(() => Y.validate(s), /tidak valid/);
  s = ok(); s.weeks[0].assign.Ferri[0] = 'XX'; assert.throws(() => Y.validate(s), /tidak valid/);
  s = ok(); s.startDate = 'kemarin'; assert.throws(() => Y.validate(s), /tidak valid/);
});

test('admin menerbitkan, Rakyat membaca, ETag/304, pembaruan sampai', async () => {
  const gh = fakeGithub('ghp_benar');
  const r1 = weekResult(PEOPLE);
  const snap1 = Y.buildSnapshot({ admin: 'Ferri', people: PEOPLE, startDate: '2026-11-16', weeks: [{ result: r1 }] });

  // pertama kali: buat gist rahasia
  const pub1 = await Y.publish({ token: 'ghp_benar', gistId: '', snapshot: snap1, fetchImpl: gh.fetchImpl });
  assert.match(pub1.id, /^[0-9a-f]{32}$/);
  assert.strictEqual(gh.gists[pub1.id].public, false, 'gist harus rahasia');

  // Rakyat baca tanpa token
  const got = await Y.fetchSnapshot({ gistId: pub1.id, etag: '', fetchImpl: gh.fetchImpl });
  assert.deepStrictEqual(got.snapshot.weeks[0].assign, r1.assign);
  assert.ok(got.etag);
  const read1 = gh.calls[gh.calls.length - 1];
  assert.strictEqual(read1.headers.Authorization, undefined, 'Rakyat tidak boleh mengirim token');

  // cek ulang dengan ETag -> 304, tidak ada data baru
  const same = await Y.fetchSnapshot({ gistId: pub1.id, etag: got.etag, fetchImpl: gh.fetchImpl });
  assert.strictEqual(same.notModified, true);

  // admin ubah jadwal -> perbarui gist yang sama
  const r2 = weekResult(['Deny', 'Ferri', 'Mifta', 'Tama', 'Ahmad']);
  const snap2 = Y.buildSnapshot({ admin: 'Ferri', people: PEOPLE, startDate: '2026-11-16', weeks: [{ result: r2 }, null] });
  const pub2 = await Y.publish({ token: 'ghp_benar', gistId: pub1.id, snapshot: snap2, fetchImpl: gh.fetchImpl });
  assert.strictEqual(pub2.id, pub1.id);
  assert.strictEqual(Object.keys(gh.gists).length, 1, 'tidak boleh membuat gist baru');

  // Rakyat otomatis mendapat versi baru
  const upd = await Y.fetchSnapshot({ gistId: pub1.id, etag: got.etag, fetchImpl: gh.fetchImpl });
  assert.ok(!upd.notModified);
  assert.strictEqual(upd.snapshot.weeks.length, 2);
  assert.deepStrictEqual(upd.snapshot.weeks[0].assign, r2.assign);
  assert.notStrictEqual(upd.etag, got.etag);
});

test('pesan error: token salah, kode salah, bukan jadwal Mixue, internet mati', async () => {
  const gh = fakeGithub('ghp_benar');
  const snap = Y.buildSnapshot({ admin: 'Ferri', people: PEOPLE, startDate: '2026-11-16', weeks: [{ result: weekResult(PEOPLE) }] });

  await assert.rejects(Y.publish({ token: 'ghp_salah', gistId: '', snapshot: snap, fetchImpl: gh.fetchImpl }), (e) => e.kind === 'auth' && /Token ditolak/.test(e.message));
  await assert.rejects(Y.publish({ token: '', gistId: '', snapshot: snap, fetchImpl: gh.fetchImpl }), (e) => e.kind === 'auth');
  await assert.rejects(Y.fetchSnapshot({ gistId: 'a'.repeat(32), etag: '', fetchImpl: gh.fetchImpl }), (e) => e.kind === 'notfound' && /Kode tidak ditemukan/.test(e.message));

  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(Y.fetchSnapshot({ gistId: 'a'.repeat(32), etag: '', fetchImpl: offline }), (e) => e.kind === 'network' && /internet/.test(e.message));
  await assert.rejects(Y.publish({ token: 'x', gistId: '', snapshot: snap, fetchImpl: offline }), (e) => e.kind === 'network');

  // gist ada tetapi bukan jadwal Mixue
  const g2 = fakeGithub('t');
  const { id } = await Y.publish({ token: 't', gistId: '', snapshot: snap, fetchImpl: g2.fetchImpl });
  g2.gists[id].files['schedule.json'].content = '{"halo":1}';
  await assert.rejects(Y.fetchSnapshot({ gistId: id, etag: '', fetchImpl: g2.fetchImpl }), (e) => e.kind === 'invalid');
  g2.gists[id].files['schedule.json'].content = 'bukan json';
  await assert.rejects(Y.fetchSnapshot({ gistId: id, etag: '', fetchImpl: g2.fetchImpl }), (e) => e.kind === 'invalid');
  delete g2.gists[id].files['schedule.json']; g2.gists[id].files['lain.txt'] = { content: 'x' };
  await assert.rejects(Y.fetchSnapshot({ gistId: id, etag: '', fetchImpl: g2.fetchImpl }), (e) => e.kind === 'invalid');
});
