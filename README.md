# Mixue Sch

Aplikasi pembuat jadwal shift otomatis untuk 5 orang (Ahmad, Ferri, Budi, Tamam, Ainun).
Web statis tanpa build dan tanpa dependensi: buka `index.html` di browser, atau aktifkan GitHub Pages.

## Cara pakai

1. Saat pertama dibuka, aplikasi menanyakan namamu (ketik atau pilih dari daftar).
2. Tab **Atur**: pilih siapa yang libur tiap hari Senin–Jumat, atau tekan **Isi libur otomatis**. Tambah request shift bila perlu.
3. Tab **Jadwalku**: hanya jadwalmu selama seminggu (Pagi / Siang / Middle, Kasir / Piket, Libur) beserta jam kerjanya.
4. Tab **Lengkap**: jadwal semua 5 orang dalam tabel berwarna, lalu **Ekspor ke WPS (.xlsx)**.
5. Gunakan panah di atas untuk pindah minggu; **Tambah minggu** di tab Atur menyarankan libur minggu berikutnya (rolling).

File ekspor `.xlsx` bisa dibuka di WPS Office, Excel, atau LibreOffice dengan tata letak SHIFT / PAGI / MIDDLE / SIANG / OFF,
keterangan kolom putih (kasir) dan biru (piket), serta tabel JAM KERJA. Di APK, tombol Ekspor membuka menu bagikan Android: pilih WPS Office.

Data tersimpan di browser/aplikasi (localStorage). Nama bisa diubah di Atur → Pengaturan.

## Aturan

- Libur 1x seminggu, hanya Senin–Jumat. Sabtu & Minggu dilarang libur.
- Senin–Jumat: Pagi (Kasir + Piket), Siang (Kasir + Piket), 1 orang libur.
- Sabtu–Minggu: Pagi (Kasir + Piket), Middle, Siang (Kasir + Piket).
- Middle Sabtu dan Minggu orang yang sama, dirotasi tiap minggu.
- Sehari sebelum libur wajib Pagi (Kasir); sehari setelah libur wajib Siang (Kasir).
- Yang kasir pagi hari Minggu = yang libur Senin minggu depan.
- Yang dapat Middle: 2x Pagi, 2x Siang. Yang lain: 3x Pagi, 3x Siang.
- Jarak libur antar minggu tidak terlalu jauh / dekat (bawaan 4–9 hari):
  Jumat → Senin dan Senin → Kamis/Jumat ditolak. Bisa diubah di Pengaturan.
- Karena yang libur Jumat wajib Kasir Siang hari Sabtu, ia tidak bisa jadi Middle minggu itu.

## APK Android

APK dibuild otomatis oleh GitHub Actions (`.github/workflows/release-apk.yml`) memakai Capacitor.
Tiap perubahan aplikasi yang di-push ke `main` (atau tag `v*`) menghasilkan rilis baru di tab **Releases** berisi file `Mixue-Sch-vX.Y.Z.apk`.
Bisa juga dijalankan manual lewat Actions → Build & Release APK → Run workflow.

Instal: unduh APK di HP → buka → izinkan instal dari sumber tidak dikenal bila diminta.

APK ditandatangani dengan `signing/mixue-sch.jks` (ikut di repo, khusus instal sideload pribadi) agar
versi baru bisa menimpa versi lama tanpa uninstall. Jangan dipakai untuk Play Store.

## Struktur

```
index.html          halaman utama
css/style.css       tampilan
js/scheduler.js     mesin penjadwalan (jalan di browser dan Node)
js/app.js           antarmuka
js/xlsx.js          pembuat file .xlsx untuk ekspor WPS
capacitor.config.json, package.json, scripts/   pembungkus APK
signing/            keystore penandatangan APK
.github/workflows/  build & release APK
test/               tes otomatis
```

## Tes

```
node --test test/scheduler.test.js
```

Tes mencakup seluruh 120 kombinasi libur, 600 kombinasi dengan Senin depan, rantai 30 minggu, dan request shift.

## GitHub Pages

Settings → Pages → Deploy from a branch → `main` / root.
