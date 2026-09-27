@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo Повтор запущен.
echo.
echo Откройте на iPhone в Safari:
echo http://192.168.0.186:4173
echo.
echo Компьютер и iPhone должны быть в одной сети Wi-Fi.
echo Не закрывайте это окно, пока пользуетесь приложением.
echo.
python -m http.server 4173 --bind 0.0.0.0
pause
