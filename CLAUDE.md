# LabPass — panduan untuk Claude Code

Prototipe peminjaman alat Lab Radar untuk tugas besar ET4043 Infrastruktur Blockchain (Kelompok 4, ITB). MVP lokal: Node.js + SQLite + Ganache (EVM lokal) + kontrak Solidity `contracts/LabPass.sol` (v2). Semua akun dan alat adalah data dummy.

## Aturan Git (WAJIB)

- **Jangan pernah menjalankan `git commit`, `git push`, `git merge`, `git rebase`, atau `git reset --hard`.** Pemilik repo melakukan commit sendiri lewat GitHub Desktop.
- Boleh menjalankan perintah baca seperti `git status`, `git diff`, `git log`.
- Setiap kali satu perubahan selesai dan tes lulus, **tutup jawaban dengan blok usulan commit** dengan format persis seperti ini:

```
USULAN COMMIT
Branch saat ini: <nama branch>
Summary: <maks. 72 karakter, kalimat perintah, Bahasa Indonesia>
Description:
- <apa yang berubah, satu poin per perubahan penting>
- <file utama yang disentuh>
- Tes: <hasil npm test, mis. "22/22 lulus">
File yang termasuk: <daftar file dari git status>
File yang JANGAN dicentang: <mis. data/, backups/, file sementara — atau "tidak ada">
```

- Kalau satu permintaan berisi beberapa perubahan yang tidak saling terkait, usulkan beberapa commit terpisah dan sebutkan file mana masuk commit mana.
- Kalau perlu branch baru, sarankan namanya; jangan membuatnya sendiri kecuali diminta.

## Perintah

- `npm ci` — pasang dependensi (sekali).
- `npm start` — jalankan server di http://127.0.0.1:8787. Jangan biarkan server berjalan di background setelah selesai menguji.
- `npm test` — 22 tes (database dan chain sementara, tidak menyentuh `data/`). **Wajib dijalankan setelah setiap perubahan kode; semua harus lulus sebelum mengusulkan commit.**
- `npm run check` — cek sintaks.
- Peringatan µWS dari Ganache dan ExperimentalWarning SQLite itu normal.

## Struktur

- `contracts/LabPass.sol` — kontrak v2: peran Student/Staff, state machine peminjaman, custom error, event `LoanStatusChanged`/`EvidenceRecorded`/`AssetReleased`.
- `contracts/legacy/LabPassV1.sol` — kontrak lama, hanya untuk membaca bukti lama. Jangan diubah.
- `lib/chain.js` — Ganache, deploy, wallet per akun, `execute`, `rejectionTest`, `assetHistory`.
- `lib/service.js` — logika bisnis, antrian `chain_ops`, verifikasi bukti.
- `lib/database.js` — skema SQLite + migrasi + data dummy.
- `server.js` — HTTP API. `public/` — frontend tanpa framework.
- `test/` — tes `node --test`. `README.md` dan `PANDUAN-TESTING.md` — dokumentasi untuk kelompok dan penguji.

## Aturan kerja

- **Jangan membaca, mengubah, atau menghapus folder `data/` dan `backups/`** (berisi database demo, chain, dan seed wallet). Untuk uji manual, pakai `LABPASS_DATA_DIR` ke folder sementara di luar repo.
- Jika kontrak diubah: perbarui tes, tabel fungsi di README (bagian "Smart contract v2"), dan panduan Remix di `PANDUAN-TESTING.md`. Perubahan kontrak harus tetap kompatibel dengan data lama (bukti v1 tetap terverifikasi), atau jelaskan dulu dampaknya sebelum mengerjakan.
- Jangan membuat klaim di dokumentasi yang tidak dibuktikan tes atau uji nyata. Model kepercayaan tetap ditulis jujur: wallet per akun, tetapi custodial.
- Utamakan perubahan kecil dan fokus. Jangan menambah dependensi baru tanpa bertanya.
- Pesan error dan teks UI dalam Bahasa Indonesia.

## Gaya komunikasi

- Bahasa Indonesia santai dan jelas; istilah English boleh.
- Saat bekerja, jangan menarasikan setiap langkah; cukup satu kalimat di awal.
- Setelah selesai: (1) intinya 1–3 kalimat, (2) apa yang dikerjakan/dicek dan hasilnya dalam poin singkat, (3) artinya untuk proyek/UAS, (4) istilah teknis baru dijelaskan 1 kalimat. Lalu blok USULAN COMMIT.
