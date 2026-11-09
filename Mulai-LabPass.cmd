@echo off
cd /d "%~dp0"
echo Membuka LabPass lokal. Biarkan jendela ini tetap terbuka.
echo Setelah muncul tulisan siap, buka http://127.0.0.1:8787
call npm start
pause
