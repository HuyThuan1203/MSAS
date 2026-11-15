# Upgrade on Windows without Docker / Administrator

The previous portable version is already running using Python 3.10.6. Keep it intact until V5 is verified.

1. Download `Market_Structure_Studio_V5.zip` and **extract it to a NEW folder**, for example `%USERPROFILE%\Market_Structure_Studio_V5`. Do not overwrite the running V4 files or data folder.
2. The ZIP contains the top-level directory `Market_Structure_Studio_V5`. Locate `app/server.py`, `static/advanced_engine.js`, `samples/raw/` and `tests/` under it. Do not launch a file from inside a ZIP.
3. V4 might still be running on port 8080. Use **8081** for V5 so the two can be compared without stopping either server:

```powershell
cd "$env:USERPROFILE\Market_Structure_Studio_V5"
$env:HOST = "127.0.0.1"
$env:PORT = "8081"
$env:DATA_DIR = "$env:USERPROFILE\Market_Structure_Studio_V5\data"
& "C:\Program Files\Python310\python.exe" .\app\server.py
```

4. In a new browser tab open `http://127.0.0.1:8081`, select BTCUSD/XAUUSD `18/06/2025 UTC`, check 48 closed candles, rewind/replay, verify Major/Minor levels & event stream. Press `Ctrl+C` in the V5 PowerShell when finished.
5. The imported-data directory of V4 is not migrated automatically. If needed, close both apps first, back up `data/`, and copy only the uploaded dataset files (`*.json` metadata and their matching raw files) into the new V5 `data/` directory. Do not overwrite same IDs with different content.
6. To move V5 to port 8080 later, stop the old V4 server (its exact process should be identified using `Get-NetTCPConnection -LocalPort 8080`) and restart V5 with `PORT=8080`.

For Docker users (after IT approval): `docker compose up --build -d` in the V5 project root, with host port mapped appropriately. **No Docker installation is required for portable Python mode.** The web app needs only Python 3.10+ standard library. Node.js is optional and is used solely for automated source rules and audit generation.

**Security:** Bind `HOST=127.0.0.1` on a company laptop. No authentication; do not expose it to the LAN/Internet. The setup does not install packages or touch `akselos-dev`.
