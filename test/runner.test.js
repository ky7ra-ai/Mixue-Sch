'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Y = require('../js/sync.js');
const S = require('../js/scheduler.js');
const PEOPLE = ['Ferri', 'Deny', 'Mifta', 'Tama', 'Ahmad'];

function env(gist) {
  const kv = {}, handlers = {}, notes = [];
  const ctx = {
    addEventListener: (n, f) => { handlers[n] = f; },
    CapacitorKV: { get: (k) => ({ value: kv[k] }), set: (k, v) => { kv[k] = v; } },
    CapacitorNotifications: { schedule: (a) => notes.push(...a) },
    fetch: async () => gist.fail ? { ok: false, status: 500 } : { ok: true, json: async () => ({ files: { 'schedule.json': { content: JSON.stringify(gist.snap) } } }) },
    Date, JSON,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../runners/runner.js'), 'utf8'), ctx);
  const run = (name, args) => new Promise((res, rej) => handlers[name](res, rej, args));
  return { kv, notes, run };
}
const snapOf = (off) => {
  const r = S.solveWeek({ people: PEOPLE, off, nextMondayOff: null, middleHistory: [], requests: [] });
  return Y.buildSnapshot({ admin: 'Ferri', people: PEOPLE, startDate: '2026-11-16', weeks: [{ result: r }] });
};

test('runner: notifikasi hanya saat jadwal berubah, sidik jari sama dengan aplikasi', async () => {
  const gist = { snap: snapOf(PEOPLE) };
  const e = env(gist);
  await e.run('checkSchedule');                       // belum ada kode
  assert.strictEqual(e.notes.length, 0);
  await e.run('setState', { code: 'a'.repeat(32), fp: Y.fingerprint(gist.snap) });
  await e.run('checkSchedule');                       // tidak berubah
  assert.strictEqual(e.notes.length, 0);
  gist.snap = snapOf(['Deny', 'Ferri', 'Mifta', 'Tama', 'Ahmad']);
  await e.run('checkSchedule');                       // berubah -> notifikasi
  assert.strictEqual(e.notes.length, 1);
  assert.match(e.notes[0].title, /diperbarui/);
  await e.run('checkSchedule');                       // sudah diberi tahu -> tidak dobel
  assert.strictEqual(e.notes.length, 1);
  gist.fail = true;
  await e.run('checkSchedule');                       // error jaringan -> diam
  assert.strictEqual(e.notes.length, 1);
});

test('runner: pertama kali tanpa sidik jari tidak membunyikan notifikasi', async () => {
  const e = env({ snap: snapOf(PEOPLE) });
  await e.run('setState', { code: 'b'.repeat(32), fp: '' });
  await e.run('checkSchedule');
  assert.strictEqual(e.notes.length, 0);
  assert.ok(e.kv.fp);
});
