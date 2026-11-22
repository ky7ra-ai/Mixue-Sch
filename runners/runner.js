/*
 * Pemeriksa jadwal di latar belakang (Mixue Rakyat), dijalankan Android tiap ~15 menit
 * lewat @capacitor/background-runner. Tidak ada DOM di sini.
 * KV: 'code' = id gist admin, 'fp' = sidik jari jadwal yang terakhir dilihat pengguna/notifikasi.
 */
const API = 'https://api.github.com/gists/';
const NOTIF_ID = 4101;

function fingerprint(s) { return JSON.stringify([s.v, s.admin, s.people, s.startDate, s.weeks]); }
function kvGet(k) { try { const r = CapacitorKV.get(k); return (r && r.value) || ''; } catch (e) { return ''; } }
function kvSet(k, v) { CapacitorKV.set(k, v); }

// Aplikasi memberi tahu kode & jadwal terakhir yang sudah tampil di layar.
addEventListener('setState', (resolve, reject, args) => {
  try {
    const a = args || {};
    kvSet('code', String(a.code || ''));
    kvSet('fp', String(a.fp || ''));
    resolve();
  } catch (e) { reject(e); }
});

addEventListener('checkSchedule', (resolve, reject) => {
  const code = kvGet('code');
  if (!code) { resolve(); return; }
  fetch(API + code, { method: 'GET', headers: { Accept: 'application/vnd.github+json' } })
    .then((res) => { if (!res.ok) throw new Error('http ' + res.status); return res.json(); })
    .then((j) => {
      const f = j && j.files && j.files['schedule.json'];
      if (!f || typeof f.content !== 'string') return null;
      const snap = JSON.parse(f.content);
      if (!snap || snap.app !== 'mixue-sch' || !Array.isArray(snap.weeks)) return null;
      return fingerprint(snap);
    })
    .then((fp) => {
      if (!fp) { resolve(); return; }
      const known = kvGet('fp');
      if (!known) { kvSet('fp', fp); resolve(); return; }      // pertama kali: jangan bunyi
      if (fp === known) { resolve(); return; }
      kvSet('fp', fp);
      CapacitorNotifications.schedule([{
        id: NOTIF_ID,
        title: 'Jadwal Mixue diperbarui',
        body: 'Admin baru memperbarui jadwal. Silakan cek jadwalmu.',
        scheduleAt: new Date(Date.now() + 1000),
      }]);
      resolve();
    })
    .catch(() => resolve()); // gagal jaringan: coba lagi di jadwal berikutnya
});
