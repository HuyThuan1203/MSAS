#!/usr/bin/env python3
"""Windows x64 Desktop candidate 1.0.0. Build-only file, not distributed."""
from __future__ import annotations
import hashlib, json, os, random, shutil, subprocess, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = "fe57f24156b48c3b3ccae5caf068056b75e8feab"
VERSION = "1.0.0"
WORK = ROOT / "desktop-build-work"
STAGE = WORK / "stage"
RELEASE = ROOT / "desktop-release"
QJS_URL = "https://github.com/quickjs-ng/quickjs/releases/download/v0.18.0/qjs-windows-x86_64.exe"
QJS_SHA = "ff03398d74ea6e6bd3a8e58058f7003225abcac229d7d57775b7aaae812a49c7"
BASE_JS = """const E=globalThis.MarketStructureEngine,A=globalThis.AdvancedStructureEngine;
function calculate(q) {
 const {candles,end}=q;
 if(!Array.isArray(candles)||!Number.isInteger(end)||end!==candles.length-1||end<0||candles.length>25000)throw Error('Invalid closed prefix');
 const result=E.analyzePrefix(candles,end);
 const advanced=A.analyzeAdvancedPrefix(candles,end,result);
 result.advanced=advanced;
 result.events=[...result.events,...advanced.events].sort((a,b)=>a.at-b.at);
 return result;
}
"""
NATIVE_TAIL = """import * as std from 'qjs:std';
for(let line;(line=std.in.getline())!==null;){
 try{std.out.puts(JSON.stringify({ok:true,result:calculate(JSON.parse(line))})+'\\n');}
 catch(e){std.out.puts(JSON.stringify({ok:false,error:String(e)})+'\\n');}
 std.out.flush();
}
"""
NODE_TAIL = """for(const line of require('fs').readFileSync(0,'utf8').split(/\\r?\\n/).filter(Boolean)){
 try{
 const q=JSON.parse(line),r=E.analyzePrefix(q.candles,q.end),a=A.analyzeAdvancedPrefix(q.candles,q.end,r);
 r.advanced=a;r.events=[...r.events,...a.events].sort((x,y)=>x.at-y.at);
 console.log(JSON.stringify({ok:true,result:r}));
 }catch(e){console.log(JSON.stringify({ok:false,error:String(e)}));}
}
"""
BRIDGE = """function getAnalysis(i){
 if(cache.has(i))return cache.get(i);
 const xhr=new XMLHttpRequest();
 xhr.open('POST','/api/desktop/analyze',false);
 xhr.setRequestHeader('Content-Type','application/json');
 xhr.send(JSON.stringify({candles:candles.slice(0,i+1),end:i}));
 if(xhr.status!==200){const e=Error('MSAS native engine unavailable ('+xhr.status+')');setError(e.message);stop();throw e;}
 const result=JSON.parse(xhr.responseText);
 cache.set(i,result);if(cache.size>140)cache.delete(cache.keys().next().value);
 return result;
}
"""
ENTRY = r'''from __future__ import annotations
import argparse, json, math, os, subprocess, sys, threading, urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOME = Path(os.environ["LOCALAPPDATA"]) / "MSAS"
BUNDLE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
ENGINE = BUNDLE / "msas_engine.exe"

def native(q):
    candles,end=q.get("candles"),q.get("end")
    if not isinstance(candles,list) or type(end) is not int or end!=len(candles)-1 or not 1<=len(candles)<=25000:
        raise ValueError("Closed prefix required")
    for c in candles:
        if not isinstance(c,dict) or any(type(c.get(k)) not in (int,float) or not math.isfinite(c[k]) for k in ("open","high","low","close")):
            raise ValueError("Invalid OHLC")
    p=subprocess.run([str(ENGINE)],input=(json.dumps(q,ensure_ascii=False,allow_nan=False)+"\n").encode("utf-8"),
         stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,check=True,
         creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    result=json.loads(p.stdout.decode("utf-8"))
    if not result.get("ok"): raise RuntimeError("Native analysis failed")
    return result["result"]

def main():
    args=argparse.ArgumentParser()
    args.add_argument("--self-test",help="Developer smoke test JSON output; no network")
    args.add_argument("--replay",action="store_true",help="Disable live network explicitly")
    a=args.parse_args()
    home=HOME if not a.self_test else Path(a.self_test).resolve().parent/"smoke-data"
    home.mkdir(parents=True,exist_ok=True)
    os.environ["DATA_DIR"]=str(home/"market_data"/"uploads")
    if sys.stdout is None or sys.stderr is None:
        log=(home/"desktop.log").open("a",encoding="utf-8",buffering=1)
        sys.stdout=log;sys.stderr=log
    import server
    from market_gateway import config as C
    from market_gateway.manager import LiveManager
    server.STATIC=BUNDLE/"static"
    server.SAMPLES=BUNDLE/"samples"
    # BUILTIN paths are constructed at import, so rebase only those paths.
    server.BUILTIN={k:(name,server.SAMPLES / path.relative_to(path.parents[1] if path.parent.name=="raw" else path.parent)) for k,(name,path) in server.BUILTIN.items()}
    server.LEGACY_DATA=home/"legacy_data"
    cfg=C.load(home/"msas.config.json",{
      "server":{"host":"127.0.0.1","port":0 if a.self_test else 18765,"open_browser":False},
      "realtime":{"enabled":not (a.replay or a.self_test),"simulator":False,
        "autostart":[{"provider":"binance","symbol":"BTCUSDT","timeframes":["M15"]}]},
      "storage":{"data_dir":str(home/"market_data")}
    },env={})
    server.configure(cfg)
    class Handler(server.Handler):
        def allowed(self):
            host="127.0.0.1:"+str(self.server.server_address[1])
            origin=self.headers.get("Origin")
            if self.headers.get("Host")!=host or (origin and origin!="http://"+host) or self.headers.get("Sec-Fetch-Site") in ("cross-site","same-site"):
                self.reply_json(403,{"error":"Local same-origin requests only"})
                return False
            return True
        def do_GET(self):
            if self.allowed(): super().do_GET()
        def do_DELETE(self):
            if self.allowed(): super().do_DELETE()
        def do_POST(self):
            if not self.allowed(): return
            if urlparse(self.path).path!="/api/desktop/analyze": return super().do_POST()
            try:
                size=int(self.headers.get("Content-Length","0"))
                if not 0<size<=32*1024*1024 or self.headers.get_content_type()!="application/json":
                    return self.reply_json(413,{"error":"Invalid analysis request"})
                result=native(json.loads(self.rfile.read(size)))
                self.reply_json(200,result)
            except (ValueError,TypeError,KeyError):
                self.reply_json(422,{"error":"Invalid closed candle prefix"})
            except Exception as exc:
                print("Native engine error",type(exc).__name__,file=sys.stderr)
                self.reply_json(500,{"error":"Native engine unavailable"})
    http=ThreadingHTTPServer(("127.0.0.1",cfg["server"]["port"]),Handler)
    http.daemon_threads=True
    url="http://127.0.0.1:"+str(http.server_address[1])
    try:
        if cfg["realtime"]["enabled"]:
            server.LIVE=LiveManager(cfg);server.LIVE.start()
        threading.Thread(target=http.serve_forever,daemon=True).start()
        if a.self_test:
            with urllib.request.urlopen(url+"/api/health",timeout=10) as r: health=json.load(r)
            with urllib.request.urlopen(url+"/api/datasets/btcusd-sample",timeout=10) as r: sample=json.load(r)
            candles=sample["candles"][:12]
            req=urllib.request.Request(url+"/api/desktop/analyze",data=json.dumps({"candles":candles,"end":len(candles)-1}).encode(),headers={"Content-Type":"application/json"})
            with urllib.request.urlopen(req,timeout=30) as r: result=json.load(r)
            with urllib.request.urlopen(url,timeout=10) as r: html=r.read().decode()
            assert health["ok"] and result["end"]==len(candles)-1 and "advanced" in result
            assert 'src="/engine.js"' not in html and 'src="/advanced_engine.js"' not in html
            for path in ("/engine.js","/advanced_engine.js"):
                try:
                    urllib.request.urlopen(url+path,timeout=10)
                    raise AssertionError("Core source served")
                except urllib.error.HTTPError as e: assert e.code==404
            Path(a.self_test).write_text(json.dumps({"status":"PASS","health":health,"native_prefix":len(candles),"core_source_http":404}),encoding="utf-8")
        else:
            import webview
            webview.create_window("MSAS 1.0.0",url,width=1440,height=900,min_size=(900,560))
            webview.start(gui="edgechromium",debug=False,private_mode=False,storage_path=str(home/"webview"))
    finally:
        http.shutdown()
        if server.LIVE: server.LIVE.stop()
        http.server_close()

if __name__=="__main__":
    try: main()
    except Exception as exc:
        import traceback
        traceback.print_exc()
        if sys.platform=="win32":
            import ctypes
            ctypes.windll.user32.MessageBoxW(None,str(exc),"MSAS startup error",0x10)
        raise
'''
INNO = r'''[Setup]
AppId=MSAS.Desktop
AppName=MSAS
AppVersion=1.0.0
DefaultDirName={localappdata}\Programs\MSAS
DefaultGroupName=MSAS
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=desktop-release
OutputBaseFilename=MSAS_1.0.0_Setup_x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\MSAS.exe
CloseApplications=yes
[Files]
Source: "desktop-build-work\dist\MSAS\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\MSAS"; Filename: "{app}\MSAS.exe"
Name: "{autodesktop}\MSAS"; Filename: "{app}\MSAS.exe"
[Run]
Filename: "{app}\MSAS.exe"; Description: "Launch MSAS"; Flags: nowait postinstall skipifsilent
'''
def run(args, **kw):
    print("+",str(args[0])," ".join(map(str,args[1:4])),flush=True)
    return subprocess.run(list(map(str,args)),check=True,**kw)

def stage():
    STAGE.mkdir(parents=True)
    static=STAGE/"static";static.mkdir()
    for name in ("chart-theme.js","i18n.js","live_controller.js","studio.css","index.html","studio.js"):
        shutil.copy2(ROOT/"static"/name,static/name)
    html=(static/"index.html").read_text("utf-8")
    for name in ("engine.js","advanced_engine.js"):
        marker='<script defer="" src="/'+name+'"></script>'
        assert html.count(marker)==1,name
        html=html.replace(marker,"")
    (static/"index.html").write_text(html,encoding="utf-8")
    js=(static/"studio.js").read_text("utf-8")
    for marker in ("const E=window.MarketStructureEngine;\n","const ADV=window.AdvancedStructureEngine;\n"):
        assert js.count(marker)==1
        js=js.replace(marker,"")
    start=js.index("function getAnalysis(i){")
    end=js.index("function setError(",start)
    js=js[:start]+BRIDGE+js[end:]
    (static/"studio.js").write_text(js,encoding="utf-8")
    samples=STAGE/"samples"
    for name in ("BTCUSD_M15_sample.csv","XAUUSD_M15_10Hours.csv",
                 "raw/BTCUSD_M15_12h_2025-06-18_UTC.csv","raw/XAUUSD_M15_12h_2025-06-18_UTC.csv"):
        dest=samples/name;dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(ROOT/"samples"/name,dest)
    (STAGE/"desktop_entry.py").write_text(ENTRY,encoding="utf-8")
    (ROOT/"desktop-build.iss").write_text(INNO,encoding="utf-8")

def compile_engine():
    qjs=WORK/"qjs.exe"
    urllib.request.urlretrieve(QJS_URL,qjs)
    assert hashlib.sha256(qjs.read_bytes()).hexdigest()==QJS_SHA,"QuickJS checksum mismatch"
    original="\n".join((ROOT/"static"/f).read_text("utf-8") for f in ("engine.js","advanced_engine.js"))
    source=WORK/"compile-only.mjs"
    source.write_text(original+"\n"+BASE_JS+NATIVE_TAIL,encoding="utf-8")
    engine=STAGE/"msas_engine.exe"
    run([qjs,"-c",source,"-o",engine])
    raw=engine.read_bytes()
    assert raw[:2]==b"MZ" and b"quickjs2" in raw[-12:]
    for f in ("engine.js","advanced_engine.js"):
        # Reject exact raw source embedded in the distribution. Bytecode is still reversible.
        s=(ROOT/"static"/f).read_text("utf-8")
        assert s.encode("utf-8") not in raw
    urllib.request.urlretrieve("https://raw.githubusercontent.com/quickjs-ng/quickjs/v0.18.0/LICENSE",STAGE/"QUICKJS-LICENSE.txt")
    return engine

def parity(engine):
    sys.path.insert(0,str(ROOT/"app"))
    from importer import normalize
    node=WORK/"oracle.cjs"
    imports="\n".join("require("+json.dumps(str(ROOT/"static"/f))+");" for f in ("engine.js","advanced_engine.js"))
    node.write_text(imports+"\n"+BASE_JS+NODE_TAIL,encoding="utf-8")
    groups=[]
    for file in sorted((STAGE/"samples").rglob("*.csv")):
        groups.append((file.name,normalize(file.read_bytes(),file.name)["candles"]))
    rng=random.Random(20261125)
    for i in range(16):
        rows=[];price=100.0
        for j in range(64):
            o=price;c=round(o+rng.uniform(-4,4),2)
            rows.append({"index":j,"time":"2026-11-25T%02d:%02d:00Z"%(j//4,(j%4)*15),
                         "open":o,"close":c,"high":round(max(o,c)+rng.random()*2,2),
                         "low":round(min(o,c)-rng.random()*2,2),"volume":None})
            price=c
        groups.append(("synthetic-"+str(i),rows))
    count=0
    for label,rows in groups:
        # Original oracle receives the entire dataset (as in the existing UI).
        # Native receives only the closed prefix: compare at every index.
        request=lambda prefix: ("\n".join(json.dumps({"candles":rows[:i+1] if prefix else rows,"end":i},ensure_ascii=False) for i in range(len(rows)))+"\n").encode("utf-8")
        expected=run(["node",node],input=request(False),stdout=subprocess.PIPE,timeout=120).stdout.decode("utf-8").splitlines()
        actual=run([engine],input=request(True),stdout=subprocess.PIPE,timeout=120).stdout.decode("utf-8").splitlines()
        assert len(expected)==len(actual)==len(rows),label
        for i,(a,b) in enumerate(zip(expected,actual)):
            x,y=json.loads(a),json.loads(b)
            assert x.get("ok") and y.get("ok"),(label,i,x.get("error"),y.get("error"))
            assert x==y,(label,i,"native result differs from baseline")
            count+=1
    report={"status":"PASS","baseline":BASELINE,"engine":"QuickJS-NG 0.18.0 stripped bytecode","datasets":len(groups),"prefixes":count,"scope":"exact JSON parity, not independent trading ground truth"}
    (RELEASE/"engine-parity.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(report,flush=True)

def main():
    if sys.platform!="win32" or sys.maxsize<2**32: raise SystemExit("Windows x64 builder required")
    for path in (WORK,RELEASE):
        if path.exists(): raise SystemExit("Remove previous generated build directory explicitly: "+str(path))
        path.mkdir()
    for name in ("engine.js","advanced_engine.js"):
        run(["git","diff","--exit-code",BASELINE,"--","static/"+name],cwd=ROOT)
    stage()
    engine=compile_engine()
    parity(engine)
    run([sys.executable,"-m","PyInstaller","--noconfirm","--clean","--windowed","--onedir","--name","MSAS",
         "--distpath",WORK/"dist","--workpath",WORK/"pyinstaller","--specpath",WORK,
         "--paths",ROOT,"--paths",ROOT/"app","--hidden-import","server","--hidden-import","importer",
         "--collect-submodules","market_gateway","--collect-all","webview",
         "--add-data",str(STAGE/"static")+";static","--add-data",str(STAGE/"samples")+";samples",
         "--add-binary",str(engine)+";.","--add-data",str(STAGE/"QUICKJS-LICENSE.txt")+";.",
         STAGE/"desktop_entry.py"],cwd=ROOT)
    dist=WORK/"dist"/"MSAS"
    assert not any(p.name in ("engine.js","advanced_engine.js","MSAS_Standalone_Offline.html") for p in dist.rglob("*"))
    smoke=RELEASE/"packaged-smoke.json"
    run([dist/"MSAS.exe","--self-test",smoke],timeout=120,cwd=ROOT)
    assert json.loads(smoke.read_text("utf-8"))["status"]=="PASS"
    shutil.rmtree(RELEASE/"smoke-data",ignore_errors=True)
    iscc=Path(os.environ.get("ProgramFiles(x86)",r"C:\Program Files (x86)"))/"Inno Setup 6"/"ISCC.exe"
    assert iscc.is_file(),"Install Inno Setup 6"
    run([iscc,ROOT/"desktop-build.iss"],cwd=ROOT)
    setup=RELEASE/"MSAS_1.0.0_Setup_x64.exe"
    assert setup.is_file() and setup.read_bytes()[:2]==b"MZ"
    (RELEASE/"SHA256SUMS.txt").write_text(hashlib.sha256(setup.read_bytes()).hexdigest()+"  "+setup.name+"\n",encoding="ascii")
    (RELEASE/"STATUS.txt").write_text("Windows x64 candidate; native parity and packaged HTTP smoke passed. Unsigned. WebView2 GUI, clean-machine install, real exchange connectivity and updater NOT VERIFIED. Requires Edge WebView2 runtime. Native executable contains recoverable bytecode, not machine-code algorithm. No public release.\\n",encoding="utf-8")
    print("BUILT",setup,flush=True)
if __name__=="__main__":
    main()
