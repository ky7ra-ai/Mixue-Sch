'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../js/scheduler.js');

const PEOPLE = ['Ahmad', 'Ferri', 'Budi', 'Tamam', 'Ainun'];

function perms(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => perms(arr.slice(0, i).concat(arr.slice(i + 1))).map((p) => [x].concat(p)));
}
const ALL_OFF = perms(PEOPLE); // 120 susunan libur Sen-Jum

test('semua 120 kombinasi libur menghasilkan jadwal valid (tanpa minggu depan)', () => {
  let bad = [];
  for (const off of ALL_OFF) {
    const r = S.solveWeek({ people: PEOPLE, off, prev: null, nextMondayOff: null, middleHistory: [], requests: [] });
    if (!r.ok) { bad.push(off.join(',') + ' => ' + r.error); continue; }
    const v = S.auditWeek(PEOPLE, r, null);
    if (v.length) bad.push(off.join(',') + ' => ' + v.join('; '));
  }
  assert.deepStrictEqual(bad, []);
});

test('semua kombinasi libur + Senin depan valid (Minggu kasir pagi = libur Senin depan)', () => {
  let bad = [], checked = 0;
  for (const off of ALL_OFF) {
    for (const nm of PEOPLE) {
      const r = S.solveWeek({ people: PEOPLE, off, prev: null, nextMondayOff: nm, middleHistory: ['Ahmad'], requests: [] });
      checked++;
      if (!r.ok) { bad.push(off.join(',') + ' next=' + nm + ' => ' + r.error); continue; }
      const v = S.auditWeek(PEOPLE, r, nm);
      if (v.length) bad.push(off.join(',') + ' next=' + nm + ' => ' + v.join('; '));
      if (r.middle === 'Ahmad') bad.push('middle tidak dirotasi: ' + off.join(','));
    }
  }
  assert.strictEqual(checked, 600);
  assert.deepStrictEqual(bad.slice(0, 5), []);
});

test('aturan jarak libur: Jumat->Senin terlalu dekat, Senin->Kamis/Jumat terlalu jauh', () => {
  const prev = { Ferri: 4, Ahmad: 0, Budi: 0 };
  const cur = { Ferri: 0, Ahmad: 3, Budi: 4 };
  const issues = S.gapIssues(prev, cur, S.DEFAULT_SETTINGS);
  const by = Object.fromEntries(issues.map((i) => [i.person, i.kind]));
  assert.strictEqual(by.Ferri, 'dekat');
  assert.strictEqual(by.Ahmad, 'jauh');
  assert.strictEqual(by.Budi, 'jauh');
  // Senin -> Rabu dan Jumat -> Selasa masih boleh
  assert.deepStrictEqual(S.gapIssues({ A: 0, B: 4 }, { A: 2, B: 1 }, S.DEFAULT_SETTINGS), []);
});

test('rantai 30 minggu dengan saran libur otomatis memenuhi semua aturan', () => {
  const weeks = [];
  let prevOff = null, history = [], prevSunday = null;
  const state = { people: PEOPLE, settings: S.DEFAULT_SETTINGS, baseline: { prevOff: null, prevMiddle: null }, weeks };
  for (let i = 0; i < 30; i++) {
    const sg = S.suggestOff({
      people: PEOPLE, partial: [null, null, null, null, null], prevOff, prevMiddle: null,
      middleHistory: history, prevSunday, settings: S.DEFAULT_SETTINGS, requests: [],
    });
    assert.ok(sg.off, 'minggu ' + i + ': ' + sg.error);
    assert.deepStrictEqual(sg.relaxed, [], 'minggu ' + i + ' aturan dilonggarkan');
    weeks.push({ off: sg.off, middle: 'auto', requests: [] });
    const all = S.computeAll(state);
    const last = all[i];
    assert.deepStrictEqual(last.errors, [], 'minggu ' + i);
    history = all.filter((a) => a.result).map((a) => a.result.middle);
    prevSunday = last.result.sunday;
    prevOff = sg.off;
  }
  const all = S.computeAll(state);
  all.forEach((a, i) => {
    assert.deepStrictEqual(a.errors, [], 'minggu ' + i);
    assert.deepStrictEqual(a.warnings, [], 'minggu ' + i + ' ' + a.warnings.join('|'));
    assert.deepStrictEqual(S.auditWeek(PEOPLE, a.result, a.nextMondayOff), [], 'audit minggu ' + i);
  });
  // Middle tidak boleh sama dua minggu berturut-turut dan terbagi rata
  const mids = all.map((a) => a.result.middle);
  for (let i = 1; i < mids.length; i++) assert.notStrictEqual(mids[i], mids[i - 1]);
  const cnt = {};
  mids.forEach((m) => { cnt[m] = (cnt[m] || 0) + 1; });
  const vals = Object.values(cnt);
  assert.ok(Math.max(...vals) - Math.min(...vals) <= 1, 'Middle tidak merata: ' + JSON.stringify(cnt));
  // Antar minggu: Minggu kasir pagi = yang libur Senin depan
  for (let i = 0; i < all.length - 1; i++) {
    assert.strictEqual(all[i].result.assign[weeks[i + 1].off[0]][6], 'PK');
  }
});

test('request masuk shift dipenuhi bila sesuai aturan', () => {
  const off = ['Ahmad', 'Ferri', 'Budi', 'Tamam', 'Ainun'];
  const base = S.solveWeek({ people: PEOPLE, off, nextMondayOff: null, middleHistory: [], requests: [] });
  // minta Tamam Siang di Selasa (bebas karena Tamam libur Kamis; Selasa tidak dipaksa Pagi)
  const requests = [{ person: 'Tamam', day: 1, shift: 'Siang' }];
  const r = S.solveWeek({ people: PEOPLE, off, nextMondayOff: null, middleHistory: [], requests });
  assert.ok(r.ok);
  assert.strictEqual(r.rejected.length, 0);
  assert.ok(S.isSiang(r.assign.Tamam[1]));
  assert.deepStrictEqual(S.auditWeek(PEOPLE, r, null), []);
  assert.ok(base.ok);
});

test('request yang melanggar aturan ditolak dengan alasan jelas', () => {
  const off = ['Ahmad', 'Ferri', 'Budi', 'Tamam', 'Ainun']; // Ferri libur Selasa
  const r = S.solveWeek({
    people: PEOPLE, off, nextMondayOff: null, middleHistory: [],
    requests: [
      { person: 'Ahmad', day: 4, shift: 'Siang' }, // Ahmad libur Senin: Jumat bebas -> ok mungkin
      { person: 'Ahmad', day: 1, shift: 'Pagi' },  // Selasa setelah libur Senin wajib Siang
      { person: 'Ferri', day: 0, shift: 'Siang' }, // Senin sebelum libur Selasa wajib Pagi
      { person: 'Ferri', day: 1, shift: 'Pagi' },  // sedang libur
      { person: 'Budi', day: 1, shift: 'Middle' }, // Middle hanya akhir pekan
    ],
  });
  assert.ok(r.ok);
  const reasons = r.rejected.map((x) => x.reason);
  assert.ok(reasons.some((x) => /setelah libur wajib masuk Siang/.test(x)));
  assert.ok(reasons.some((x) => /sebelum libur wajib masuk Pagi/.test(x)));
  assert.ok(reasons.some((x) => /sedang libur/.test(x)));
  assert.ok(reasons.some((x) => /hanya ada di Sabtu/.test(x)));
  assert.deepStrictEqual(S.auditWeek(PEOPLE, r, null), []);
});

test('request Middle dipenuhi dan Sabtu-Minggu orang yang sama', () => {
  const off = ['Ahmad', 'Ferri', 'Budi', 'Tamam', 'Ainun'];
  const r = S.solveWeek({
    people: PEOPLE, off, nextMondayOff: null, middleHistory: [],
    requests: [{ person: 'Budi', day: 5, shift: 'Middle' }],
  });
  assert.ok(r.ok);
  assert.strictEqual(r.middle, 'Budi');
  assert.strictEqual(r.assign.Budi[5], 'M');
  assert.strictEqual(r.assign.Budi[6], 'M');
});

test('Middle tidak boleh yang libur Jumat atau libur Senin depan', () => {
  const off = ['Ahmad', 'Ferri', 'Budi', 'Tamam', 'Ainun']; // Ainun libur Jumat
  const r = S.solveWeek({
    people: PEOPLE, off, nextMondayOff: 'Ferri', middleHistory: [],
    requests: [{ person: 'Ainun', day: 5, shift: 'Middle' }],
  });
  assert.ok(r.ok);
  assert.ok(r.rejected.length === 1);
  assert.ok(r.middle !== 'Ainun' && r.middle !== 'Ferri');
  const fixed = S.solveWeek({ people: PEOPLE, off, nextMondayOff: null, middleHistory: [], middleFixed: 'Ainun', requests: [] });
  assert.ok(!fixed.ok);
});

test('input libur tidak lengkap atau dobel ditolak', () => {
  const r1 = S.solveWeek({ people: PEOPLE, off: ['Ahmad', null, 'Budi', 'Tamam', 'Ainun'], middleHistory: [], requests: [] });
  assert.ok(!r1.ok);
  const r2 = S.solveWeek({ people: PEOPLE, off: ['Ahmad', 'Ahmad', 'Budi', 'Tamam', 'Ainun'], middleHistory: [], requests: [] });
  assert.ok(!r2.ok);
});

test('tanggal: snap ke Senin dan Senin berikutnya', () => {
  assert.strictEqual(S.snapToMonday('2026-11-21'), '2026-11-16');
  assert.strictEqual(S.nextMonday('2026-11-21'), '2026-11-23');
  assert.strictEqual(S.nextMonday('2026-11-23'), '2026-11-23');
  assert.strictEqual(S.addDays('2026-11-23', 7), '2026-11-30');
});

/* ---------- ekspor XLSX ---------- */
const zlib = require('node:zlib');
const X = require('../js/xlsx.js');

function readZip(buf) {
  // baca central directory, kembalikan {nama: {crc, size, data}}
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
  assert.ok(eocd >= 0, 'EOCD tidak ada');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < n; i++) {
    assert.strictEqual(buf.readUInt32LE(p), 0x02014b50);
    const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    const lnl = buf.readUInt16LE(lo + 26), lel = buf.readUInt16LE(lo + 28);
    const data = buf.slice(lo + 30 + lnl + lel, lo + 30 + lnl + lel + size);
    out[name] = { crc, size, data };
    p += 46 + nl + el + cl;
  }
  return out;
}

test('ekspor xlsx: zip valid, CRC cocok, nama & warna sesuai', () => {
  const r = S.solveWeek({ people: PEOPLE, off: PEOPLE, nextMondayOff: null, middleHistory: [], requests: [] });
  const U = (v) => (v ? v.toUpperCase() : '');
  const model = {
    days: S.DAYS.map((n, d) => ({ name: n.toUpperCase(), date: S.addDays('2026-11-23', d) })),
    pagiK: r.days.map((x) => U(x.PK)), pagiP: r.days.map((x) => U(x.PP)),
    middle: r.days.map((x, d) => (d >= 5 ? U(x.M) : '')),
    siangK: r.days.map((x) => U(x.SK)), siangP: r.days.map((x) => U(x.SP)),
    off: r.days.map((x, d) => (d < 5 ? U(x.off) : '')),
  };
  const buf = Buffer.from(X.buildWeekWorkbook(model));
  const files = readZip(buf);
  ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']
    .forEach((n) => assert.ok(files[n], 'hilang: ' + n));
  Object.entries(files).forEach(([n, f]) => assert.strictEqual(zlib.crc32(f.data), f.crc, 'CRC salah: ' + n));
  const sst = files['xl/sharedStrings.xml'].data.toString('utf8');
  ['SHIFT', 'PAGI', 'MIDDLE', 'SIANG', 'OFF', 'KOLOM PUTIH JADWAL KASIR', 'KOLOM BIRU JADWAL PIKET', 'JAM KERJA', '08.00-17.00', '11.00-20.00', '13.00-22.00', 'CLOSING']
    .forEach((t) => assert.ok(sst.includes('>' + t + '<'), 'teks hilang: ' + t));
  const styles = files['xl/styles.xml'].data.toString('utf8');
  ['FFFFE600', 'FF92D050', 'FF00B0F0', 'FFFF0000'].forEach((c) => assert.ok(styles.includes(c), 'warna hilang: ' + c));
});
