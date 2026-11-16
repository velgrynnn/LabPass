@echo off
setlocal
cd /d "%~dp0" || exit /b 1
where.exe node.exe >nul 2>&1 || goto missing_node
node scripts/reset-demo.js
if errorlevel 1 goto failed
pause
exit /b 0

:missing_node
echo Instal Node.js sesuai README sebelum memakai reset demo.
:failed
pause
exit /b 1
