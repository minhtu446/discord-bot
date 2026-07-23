@echo off
echo ========================================
echo   Push to GitHub
echo ========================================
cd /d "%~dp0"
git add -A
git status --short
echo.
echo Dang commit...
git commit -m "manual: %date% %time%"
echo.
echo Dang push...
git push origin main
echo.
echo Xong!
pause
