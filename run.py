import os
import sys
import socket
import uvicorn

# Ensure utf-8 output on Windows terminal
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def print_banner(ip, port):
    banner = f"""
========================================================================
   [+] F.E.L.I.C.I.A. // TACTICAL FIRETEAM INTELLIGENCE CONSTRUCT [+]
   "Fireteam Evaluation & Logistics Intelligence Construct for Interactive Analysis"
   Personality: Scottish Accent // Destiny 2 Vanguard Systems Specialist
========================================================================

 [DESKTOP BROWSER] -> http://localhost:{port}
 [PHONE / IPAD]    -> http://{ip}:{port}
 [FIREBASE RTDB]   -> https://stark-industries-server-default-rtdb.firebaseio.com/
 [GEMINI ENGINE]   -> gemini-3.8-flash (Cascades to gemini-3.5-flash)

 Connect any iPhone, iPad, or mobile device on your Wi-Fi to:
 >>> http://{ip}:{port} <<< (Or tap 'Connect Mobile' in the web HUD)
========================================================================
"""
    try:
        print(banner)
    except Exception:
        pass

if __name__ == "__main__":
    ip = get_lan_ip()
    port = 8000
    print_banner(ip, port)
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, log_level="info")
