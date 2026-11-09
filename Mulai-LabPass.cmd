@echo off
setlocal
cd /d "%~dp0" || goto folder_error

where.exe node.exe >nul 2>&1 || goto missing_node
where.exe npm.cmd >nul 2>&1 || goto missing_npm
node --no-warnings -e "require('node:sqlite')" >nul 2>&1 || goto unsupported_node

node -e "for (const name of ['ethers', 'ganache', 'solc']) require.resolve('./node_modules/' + name)" >nul 2>&1
if errorlevel 1 (
    echo Menyiapkan dependensi LabPass. Pastikan internet terhubung.
    call npm.cmd ci --no-audit --no-fund
    if errorlevel 1 goto install_error
)

echo Membuka LabPass lokal. Biarkan jendela ini tetap terbuka.
echo Setelah muncul tulisan LabPass siap, buka alamat yang tercetak.
call npm.cmd start
if errorlevel 1 goto start_error
exit /b 0

:folder_error
echo Folder LabPass tidak bisa dibuka. Ekstrak ZIP sebelum menjalankan file ini.
goto failed

:missing_node
echo Windows tidak menemukan Node.js.
echo Instal Node.js 22.18 atau lebih baru dari https://nodejs.org/en/download
echo Gunakan Windows Installer, lalu tutup terminal dan jalankan file ini lagi.
goto failed

:missing_npm
echo Windows menemukan Node.js, tetapi npm belum tersedia.
echo Perbaiki instalasi Node.js dan pastikan opsi npm serta Add to PATH aktif.
goto failed

:unsupported_node
echo Versi Node.js ini belum mendukung SQLite yang dipakai LabPass.
echo Instal Node.js 22.18 atau lebih baru dari https://nodejs.org/en/download
goto failed

:install_error
echo Instalasi dependensi gagal. Cek koneksi internet dan pesan npm di atas.
goto failed

:start_error
echo LabPass gagal berjalan. Lihat pesan error di atas.

:failed
pause
exit /b 1
