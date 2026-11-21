# Mixue Sch

Aplikasi pembuat jadwal shift otomatis untuk 5 orang (Ahmad, Ferri, Budi, Tamam, Ainun).
Web statis tanpa build dan tanpa dependensi: buka `index.html` di browser, atau aktifkan GitHub Pages.

## Cara pakai

1. Buka `index.html`.
2. Pilih siapa yang libur di tiap hari Senin–Jumat, atau tekan **Isi libur otomatis**.
3. Sistem menyusun Pagi/Siang/Middle, Kasir/Piket untuk 7 hari.
4. Tambah **Request masuk shift** bila ada. Yang melanggar aturan ditolak beserta alasannya.
5. Tekan **Tambah minggu** untuk minggu berikutnya (libur disarankan otomatis mengikuti rolling).
6. Salin teks, unduh CSV, atau cetak.

Data tersimpan di browser (localStorage). Nama bisa diubah di bagian Pengaturan.

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

## Struktur

```
index.html          halaman utama
css/style.css       tampilan
js/scheduler.js     mesin penjadwalan (jalan di browser dan Node)
js/app.js           antarmuka
test/               tes otomatis
```

## Tes

```
node --test test/scheduler.test.js
```

Tes mencakup seluruh 120 kombinasi libur, 600 kombinasi dengan Senin depan, rantai 30 minggu, dan request shift.

## GitHub Pages

Settings → Pages → Deploy from a branch → `main` / root.
