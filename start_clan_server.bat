@echo off
title F.E.L.I.C.I.A. Clan Server
echo ========================================================================
echo    [+] F.E.L.I.C.I.A. // CLAN ACCESS LAUNCHER [+]
echo    Custom Web Domain: https://feliciadatabase.loca.lt
echo    Backup Cloudflare: https://brook-noble-firewall-montgomery.trycloudflare.com
echo ========================================================================

start "FELICIA Server" python "%~dp0run.py"
timeout /t 3 /nobreak >nul
start "FELICIA Cloudflare Tunnel" "%~dp0bin\cloudflared.exe" tunnel --url http://127.0.0.1:8000
start "FELICIA Public Domain" cmd /c "title Localtunnel && :loop && npx -y localtunnel --port 8000 --subdomain feliciadatabase && timeout /t 3 >nul && goto loop"

echo.
echo Both Local Server and Public Tunnels are active!
echo Share with your Clan: https://feliciadatabase.loca.lt
pause
