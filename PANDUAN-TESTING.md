# Panduan uji dummy LabPass

Jalankan alur utama bersama kelompok terlebih dahulu. Sisihkan sekitar 15–20 menit untuk mencoba kedua peran, memeriksa bukti blockchain, dan mengambil tangkapan layar. Gunakan hasil aktual sebagai bahan slide implementasi dan demo.

## Mulai dari sini untuk laporan progres

Kerjakan satu alur normal di bagian **Uji utama**, lalu satu penolakan kontrak di bagian **Uji smart contract di Remix VM**. Ambil tiga screenshot aplikasi seperti daftar di bagian akhir, ditambah satu screenshot pesan **AlreadyRecorded** di Remix. Dua hasil verifikasi dapat digabung dalam satu gambar perbandingan agar slide ringkas. Masukkan ID pinjaman dan tx hash pada keterangan gambar. Simpan screenshot langkah lain sebagai lampiran bila diperlukan.

Login manual memakai ID yang terdaftar, misalnya **Dimas** dengan `mhs-4` dan **Petugas PKL** dengan `staff-pkl`. Kata sandi keduanya `demo123`. Nama seperti `Dimas` atau NIM pribadi tidak digunakan sebagai ID login pada data dummy ini. Contoh alur di bawah menggunakan Alya dan Pak Zaenal dengan hak akses yang sama.

Kedua peran harus menggunakan server yang sama. Dua laptop yang masing-masing membuka server `127.0.0.1` akan membaca database lokal masing-masing. Untuk demo, jalankan dua peran pada satu komputer melalui browser biasa dan Incognito.

## Persiapan

1. Buka LabPass di http://127.0.0.1:8787. Jika server belum jalan, klik dua kali `Mulai-LabPass.cmd` di folder LabPass dan biarkan terminal terbuka.
2. Masuk manual sebagai **Alya** (`mhs-1`) di browser biasa. Buka jendela incognito atau browser lain untuk **Pak Zaenal** (`staff-zaenal`). Dua tab biasa berbagi sesi. Kata sandi kedua akun dummy adalah `demo123`.
3. Buka **Bukti & jaringan** dan pastikan jaringan Ethereum lokal aktif. Gunakan identitas dan foto dummy selama pengujian.
4. Pilih Board RL M-2 (`LP-RL-001`) jika tersedia, atau unit lain yang berstatus **Tersedia**. Catat ID unit dan ID pengajuan supaya kedua penguji membuka transaksi yang sama.

## Uji utama

Saat berpindah peran, klik **Perbarui status** pada halaman detail transaksi. Di daftar peminjaman, tombol **Perbarui** tetap tersedia.

| No. | Peran dan langkah | Hasil yang diharapkan |
| --- | --- | --- |
| 1 | **Alya.** Pilih alat, isi tujuan `Uji dummy kelompok – praktikum RL`, dosen `Dosen Demo`, tanggal mulai hari ini dan tanggal kembali besok. Kirim pengajuan. | Transaksi berstatus **Diajukan** dan muncul di daftar petugas. |
| 2 | **Pak Zaenal.** Buka pengajuan dan klik **Setujui pengajuan**. | Transaksi **Disetujui**, unit **Dipesan**. |
| 3 | **Pak Zaenal.** Klik **Catat serah terima**. Pilih **Baik**, isi kelengkapan sesuai jumlah standar. Bila memakai foto, unggah pada bagian **Foto serah terima awal** di formulir ini, tunggu unggahan selesai, lalu simpan. | Status **Konfirmasi pengambilan**. Riwayat serah terima menunjukkan **Tercatat on-chain**. Foto tahap ini terkunci sampai peminjam mengonfirmasi. |
| 4 | **Alya.** Buka ulang transaksi, klik **Konfirmasi penerimaan alat**, lalu setujui rekaman. | Transaksi dan unit **Dipinjam**. Konfirmasi peminjam muncul sebagai kejadian baru. |
| 5 | **Alya.** Pada riwayat konfirmasi, klik **Verifikasi**. Periksa hasil dan catat hash transaksi. | Rekaman database, arsip asli, komitmen blockchain, dan identitas saat ini menunjukkan **Cocok**. Hash transaksi dan nomor blok tampil. |
| 6 | **Alya.** Di jendela yang sama, klik **Simulasikan NIM berubah**. | Baris **JSON kandidat yang diperiksa** menunjukkan **Tidak cocok**. Hasil untuk arsip asli dan komitmen blockchain tetap **Cocok**. |
| 7 | **Alya.** Tutup verifikasi dan klik **Ajukan pengembalian**. | Transaksi **Menunggu pemeriksaan**. Unit masih **Dipinjam** sampai diperiksa. |
| 8 | **Pak Zaenal.** Klik **Perbarui status**, lalu **Periksa pengembalian**. Isi kondisi **Baik** dan semua kelengkapan sesuai standar. Foto opsional ditambahkan pada **Foto pengembalian** sebelum menyimpan. | Transaksi **Konfirmasi pengembalian**. Foto pengembalian masuk bukti tahap ini. |
| 9 | **Alya.** Buka ulang transaksi, klik **Konfirmasi hasil pengembalian**, lalu setujui rekaman. Cek inventaris. | Transaksi **Selesai**, unit kembali **Tersedia**. Pemeriksaan dan konfirmasi pengembalian muncul di riwayat. |

Simulasi pada langkah 6 mengedit salinan JSON bukti. NIM asli pada database tetap tersimpan di luar blockchain. Smart contract menyimpan hash yang dipakai untuk memeriksa kecocokan salinan dengan bukti yang dicatat.

## Uji tambahan jika alur utama sudah lulus

| Skenario | Cara menguji dan hasil yang diharapkan |
| --- | --- |
| Kelengkapan kurang | Buat transaksi baru untuk ADALM-Pluto jika tersedia. Saat pemeriksaan **pengembalian**, isi jumlah kabel coax `0`. Setelah mahasiswa mengonfirmasi, transaksi **Selesai** dan unit **Perlu pemeriksaan**. |
| Peminjaman ganda | Sebelum persetujuan, ajukan satu unit yang sama dari Alya dan Bima (`mhs-2`). Setujui satu pengajuan. Coba setujui pengajuan kedua. Persetujuan kedua harus ditolak dan transaksi pertama tetap berjalan. |
| Akses akun lain | Masuk sebagai Bima. Daftar **Peminjaman saya** hanya menampilkan pengajuan Bima. Pengajuan Alya tetap terlihat dari akun petugas. |
| Foto opsional | Tambah foto dummy PNG/JPEG maksimal 3 MB sebelum mencatat serah terima. Pada verifikasi bukti serah terima tersebut, baris foto menunjukkan **Cocok**. |
| Batal sebelum menerima alat | Petugas menyimpan pemeriksaan awal. Mahasiswa memilih **Batalkan peminjaman** dan mengonfirmasi pembatalan. Status menjadi **Dibatalkan**, unit kembali **Tersedia**, dan bukti pemeriksaan awal tetap dapat diverifikasi. |

Jika data sudah terlalu ramai untuk mengambil screenshot baru, ikuti bagian [Reset demo dengan cadangan](README.md#reset-demo-dengan-cadangan). Simpan bukti yang ingin dipakai untuk laporan sebelum memulai demo baru.

## Uji smart contract di Remix VM

Bagian ini menguji [kontrak LabPass yang sama](contracts/LabPass.sol) secara terpisah dari aplikasi. Remix VM menjalankan jaringan uji di browser dan memakai akun simulasi. Aplikasi LabPass tetap memakai Ganache lokal, sehingga kedua pengujian memiliki riwayat transaksi masing-masing.

Untuk mengecek transaksi dari web LabPass, gunakan **Verifikasi** dan **Salin tx hash** pada riwayat web. Alamat kontrak dan tx hash dari Ganache lokal tidak dapat langsung dibaca lewat Remix VM karena itu jaringan yang berbeda. Uji Remix berikut menunjukkan fungsi kontrak dengan data dummy terpisah. [Dokumentasi resmi Remix](https://remix-ide.readthedocs.io/en/latest/run.html) menjelaskan bahwa Remix VM merupakan blockchain uji di browser.

1. Buka [Remix IDE](https://app.remix.live/), buat file `LabPass.sol`, lalu salin isi [kontrak di repo](contracts/LabPass.sol).
2. Di **Solidity Compiler**, pilih **0.8.34** dan klik **Compile**. Versi ini digunakan pada uji Remix kelompok.
3. Buka **Deploy & Run**. Pilih **Remix VM (Osaka)** sebagai lingkungan, pilih **LabPass**, lalu klik **Deploy**. Konstruktor tidak meminta parameter. Akun yang melakukan deploy menjadi operator.
4. Buka **Deployed Contracts** dan pilih instans LabPass. Pada fungsi `recordEvidence`, isi **recordId** dan **digest** dengan dua nilai dummy berikut, lalu klik **Transact**.

   ```text
   recordId  0x0000000000000000000000000000000000000000000000000000000000000001
   digest    0x12c3c7f860c60baa2187c76078bc23b6ffb505f7ed775ec33b7b43cfaa239583
   ```

5. Masukkan **recordId** yang sama ke `proofs` lalu klik **Call**. Hasil yang diharapkan adalah **digest** yang sama dan **recordedAt** lebih besar dari nol.
6. Jalankan `recordEvidence` lagi dengan **recordId** yang sama. Transaksi harus ditolak dengan **AlreadyRecorded**. Panggil `proofs` lagi untuk memeriksa bukti awal.

Panduan membaca hasil Remix:

- `recordEvidence` memiliki dua kolom **bytes32**. Salin nilai lengkap dari blok di atas, termasuk `0x`. Masing-masing harus berisi 64 digit heksadesimal setelah `0x`.
- `proofs` menerima satu **recordId**. Tekan **Call** untuk membaca. **digest** harus sama dengan input dan **recordedAt** harus lebih dari nol.
- Setelah ID yang sama dikirim lagi, buka transaksi merah di terminal Remix dan cari **AlreadyRecorded**. Ini hasil penolakan yang diharapkan.
- `recordId` pada contoh adalah kode bukti dummy. Akun Remix adalah alamat operator blockchain. Keduanya berbeda dari ID login LabPass seperti `mhs-4` atau `staff-pkl`.

Uji pada **9 November 2026** berhasil melakukan deploy, mencatat dan membaca hash, serta menolak pencatatan ulang. Untuk mengulang dari keadaan kosong, deploy instans kontrak baru. Simpan tangkapan layar hasil `proofs` dan pesan **AlreadyRecorded** sebagai bukti demo.

## Catat hasil dan ambil bahan PPT

Gunakan **Lulus**, **Gagal**, atau **Belum dicoba** untuk setiap skenario. Untuk hasil gagal, simpan langkah, akun, ID transaksi, hasil yang muncul, dan tangkapan layar agar bisa diulang.

| Tanggal / penguji | Langkah / skenario | ID transaksi | Hasil aktual dan bukti | Status |
| --- | --- | --- | --- | --- |
|  |  |  |  | Belum dicoba |

Ambil tiga tangkapan layar dari transaksi yang sama.

1. Riwayat dengan status **Selesai**, sebagai bukti alur pengajuan sampai pengembalian.
2. Dialog **Verifikasi** sebelum simulasi, dengan status cocok dan hash transaksi lokal.
3. Dialog setelah simulasi perubahan NIM, dengan hasil kandidat **Tidak cocok**.

Pakai gambar pertama untuk bagian **Implementation** dan dua gambar berikutnya untuk menunjukkan apa yang diuji di bagian **Blockchain Fit** atau demo. Brief UAS memberi maksimum tujuh menit untuk keseluruhan presentasi dan demo. Siapkan satu transaksi yang sudah selesai, tampilkan riwayat, salin tx hash, lalu buka verifikasi dan simulasi perubahan NIM. Siapkan juga satu penolakan kontrak di Remix dan simpan tangkapan layar sebagai cadangan.

Jika ingin menjalankan cek teknis yang sudah ada, gunakan `npm test` dari folder LabPass. Catat hasil uji otomatis dan hasil uji browser kelompok secara terpisah.
