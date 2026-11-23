# Panduan uji dummy LabPass

Jalankan alur utama bersama kelompok terlebih dahulu. Sisihkan sekitar 15–20 menit untuk mencoba kedua peran, memeriksa bukti blockchain, dan mengambil tangkapan layar. Gunakan hasil aktual sebagai bahan slide implementasi dan demo.

## Mulai dari sini untuk laporan progres

Kerjakan satu alur normal di bagian **Uji utama**, lalu satu penolakan kontrak di bagian **Uji penolakan kontrak dari aplikasi**. Ambil screenshot aplikasi seperti daftar di bagian akhir, ditambah dialog **Ditolak: NotBorrower**. Uji Remix menjadi cadangan. Dua hasil verifikasi dapat digabung dalam satu gambar perbandingan agar slide ringkas. Masukkan ID pinjaman dan tx hash pada keterangan gambar. Simpan screenshot langkah lain sebagai lampiran bila diperlukan.

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

## Uji penolakan kontrak dari aplikasi

Cara paling cepat untuk demo kasus negatif. Masuk sebagai petugas.

1. Buka transaksi yang berstatus **Konfirmasi pengambilan** (setelah petugas mencatat serah terima, sebelum mahasiswa mengonfirmasi).
2. Pada kartu **Status di smart contract**, klik **Uji: petugas konfirmasi atas nama peminjam**.
3. Hasil yang diharapkan: dialog **Ditolak: NotBorrower**, hasil transaksi **Gagal sesuai harapan (status 0)**, dan status kontrak tetap **Konfirmasi pengambilan → Konfirmasi pengambilan**. Salin tx hash untuk slide.
4. Di **Bukti & jaringan**, coba juga dua tombol lain: wallet tanpa peran → `Unauthorized`, wallet mahasiswa menyetujui → `NotStaff`.
5. Buka **Inventaris alat**, pilih alat yang tadi dipakai, lalu **Riwayat on-chain alat**. Tampil urutan status dan bukti yang dibaca dari event kontrak.

Transaksi uji dikirim langsung ke kontrak tanpa melewati pengecekan backend. Database tidak berubah.

## Uji smart contract di Remix VM

Bagian ini menguji [kontrak LabPass v2](contracts/LabPass.sol) secara terpisah dari aplikasi. Remix VM menjalankan jaringan uji di browser dan memakai akun simulasi. Aplikasi LabPass tetap memakai Ganache lokal, sehingga tx hash dari web tidak bisa dibaca di Remix. [Dokumentasi resmi Remix](https://remix-ide.readthedocs.io/en/latest/run.html) menjelaskan bahwa Remix VM merupakan blockchain uji di browser.

Siapkan tiga akun dari daftar **Account** di Remix: **Akun A** (deploy/admin), **Akun B** (mahasiswa), **Akun C** (petugas). Salin alamatnya ke catatan.

1. Buka [Remix IDE](https://app.remix.live/), buat file `LabPass.sol`, lalu salin isi [kontrak di repo](contracts/LabPass.sol).
2. Di **Solidity Compiler**, pilih **0.8.24 atau lebih baru** lalu **Compile**.
3. Di **Deploy & Run**, pilih **Remix VM**, akun **A**, kontrak **LabPass**, lalu **Deploy**.
4. Masih dengan akun A, jalankan `setRole(alamat B, 1)` dan `setRole(alamat C, 2)`. Angka 1 = Student, 2 = Staff.
5. Pindah ke akun **B**. Jalankan `requestLoan` dengan nilai berikut:

   ```text
   loanId   0x4c4f414e2d52454d495800000000000000000000000000000000000000000000
   assetId  0x4c502d4f53432d30303100000000000000000000000000000000000000000000
   ```

   Nilai di atas adalah teks `LOAN-REMIX` dan `LP-OSC-001` dalam bentuk bytes32.
6. **Uji penolakan 1:** masih dengan akun B, jalankan `approve(loanId)`. Harus gagal dengan **NotStaff**.
7. Pindah ke akun **C**, jalankan `approve(loanId)`. Berhasil. Panggil `loans(loanId)`: kolom `status` bernilai **2** (Approved).
8. Akun C menjalankan `handover` dengan `loanId`, `recordId` dan `digest` berikut:

   ```text
   recordId 0x0000000000000000000000000000000000000000000000000000000000000001
   digest   0x12c3c7f860c60baa2187c76078bc23b6ffb505f7ed775ec33b7b43cfaa239583
   ```

9. **Uji penolakan 2:** masih akun C, jalankan `confirmPickup` dengan `loanId`, recordId `0x…02`, dan digest yang sama. Harus gagal dengan **NotBorrower**: petugas tidak bisa mengonfirmasi atas nama peminjam.
10. Pindah ke akun **B**, jalankan `confirmPickup` yang sama. Berhasil; `loans(loanId)` menunjukkan status **4** (Borrowed).
11. **Uji penolakan 3:** jalankan lagi `confirmPickup` dari akun B. Harus gagal dengan **InvalidStatus** karena status sudah Borrowed.

Panduan membaca hasil Remix:

- Semua kolom **bytes32** harus berisi `0x` dan 64 digit heksadesimal. Salin nilai lengkap dari blok di atas.
- Nomor status: 0 None, 1 Requested, 2 Approved, 3 HandoverPending, 4 Borrowed, 5 ReturnRequested, 6 ReturnPending, 7 Closed, 8 Rejected, 9 Cancelled.
- Transaksi yang ditolak tampil merah di terminal Remix. Buka detailnya dan cari nama error (**NotStaff**, **NotBorrower**, **InvalidStatus**).
- Tab **Logs** pada transaksi berhasil menampilkan event `LoanStatusChanged` dan `EvidenceRecorded`.
- Akun Remix berbeda dari ID login LabPass seperti `mhs-4` atau `staff-pkl`.

Untuk mengulang dari keadaan kosong, deploy instans kontrak baru. Simpan tangkapan layar setiap penolakan sebagai cadangan demo.

## Catat hasil dan ambil bahan PPT

Gunakan **Lulus**, **Gagal**, atau **Belum dicoba** untuk setiap skenario. Untuk hasil gagal, simpan langkah, akun, ID transaksi, hasil yang muncul, dan tangkapan layar agar bisa diulang.

| Tanggal / penguji | Langkah / skenario | ID transaksi | Hasil aktual dan bukti | Status |
| --- | --- | --- | --- | --- |
|  |  |  |  | Belum dicoba |

Ambil tiga tangkapan layar dari transaksi yang sama.

1. Riwayat dengan status **Selesai**, sebagai bukti alur pengajuan sampai pengembalian.
2. Dialog **Verifikasi** sebelum simulasi, dengan status cocok dan hash transaksi lokal.
3. Dialog setelah simulasi perubahan NIM, dengan hasil kandidat **Tidak cocok**.

Pakai gambar pertama untuk bagian **Implementation** dan dua gambar berikutnya untuk menunjukkan apa yang diuji di bagian **Blockchain Fit** atau demo. Brief UAS memberi maksimum tujuh menit untuk keseluruhan presentasi dan demo. Siapkan satu transaksi yang sudah selesai, tampilkan riwayat, salin tx hash, lalu buka verifikasi dan simulasi perubahan NIM. Tunjukkan satu penolakan kontrak dari aplikasi (NotBorrower) dan riwayat on-chain alat. Simpan tangkapan layar uji Remix sebagai cadangan.

Jika ingin menjalankan cek teknis yang sudah ada, gunakan `npm test` dari folder LabPass. Catat hasil uji otomatis dan hasil uji browser kelompok secara terpisah.
