$env:PATH = "C:\Users\kingh\AppData\Local\Programs\nodejs;$env:PATH"
Write-Host "[Localtunnel Watchdog] Starting daemon for feliciadatabase.loca.lt..."

while ($true) {
    try {
        npx -y localtunnel --port 8000 --subdomain feliciadatabase
    } catch {
        Write-Host "[Localtunnel Watchdog] Connection dropped, restarting in 3s..."
    }
    Start-Sleep -Seconds 3
}
