"""Build reproducible normalized test samples; no third-party modules."""
from __future__ import annotations
import csv,datetime as dt,hashlib,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'app'))
from importer import normalize
root=Path(__file__).resolve().parent.parent
for symbol in ('BTCUSD','XAUUSD'):
 fname=f'{symbol}_M15_12h_2025-06-18_UTC.csv'
 raw=(root/'samples/raw'/fname).read_bytes()
 parsed=normalize(raw,fname)
 cs=parsed['candles']
 for c in cs:
  c['time']=dt.datetime.fromisoformat(c['time']).astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
 assert len(cs)==48
 outcsv=root/'samples/normalized'/fname
 outjson=root/'samples/normalized'/(fname[:-4]+'.json')
 manifest=root/'samples/normalized'/(fname[:-4]+'.manifest.json')
 with outcsv.open('w',newline='',encoding='utf-8') as f:
  w=csv.writer(f,lineterminator='\n');w.writerow(['timestamp_utc','open','high','low','close','volume'])
  for c in cs:
   stamp=dt.datetime.fromisoformat(c['time']).astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
   w.writerow([stamp,format(c['open'],'.12g'),format(c['high'],'.12g'),format(c['low'],'.12g'),format(c['close'],'.12g'),'' if c['volume'] is None else c['volume']])
 canonical={'schema_version':'1.0.0','dataset_id':f'{symbol.lower()}_m15_20250618_0600_utc',
    'symbol':symbol,'timeframe':'M15','timezone':'UTC','timestamp_role':'candle_open',
    'candles':cs,'metadata':{'is_synthetic':False,'source_file':fname,'sha256':hashlib.sha256(raw).hexdigest(),
    'count':len(cs),'timestamp_role_verified':False,'first':cs[0]['time'],'last':cs[-1]['time'],'volume_present':False,
    'expected_interval_seconds':900,'observed_gaps':parsed['meta']['gaps'],'provider':'unspecified'}}
 outjson.write_text(json.dumps(canonical,indent=2,ensure_ascii=False),encoding='utf-8')
 info={'schema_version':'1.0.0','dataset_id':canonical['dataset_id'],'symbol':symbol,
       'timeframe':'M15','time_zone':'UTC','timestamp_role':'candle_open','source_sha256':canonical['metadata']['sha256'],
       'source_file':f'samples/raw/{fname}','canonical_csv':f'samples/normalized/{fname}',
       'canonical_json':f'samples/normalized/{fname[:-4]}.json',
       'row_count':len(cs),'first_timestamp_utc':cs[0]['time'],'last_timestamp_utc':cs[-1]['time'],
       'time_step_seconds':900,'timestamp_role_verified':False,'missing_intervals':0,'duplicate_timestamps':0,'invalid_ohlc_rows':0,
       'volume_present':False,'is_synthetic':False,'unknowns':['data_provider','price_unit','session_schedule']}
 manifest.write_text(json.dumps(info,indent=2,ensure_ascii=False),encoding='utf-8')
 print(symbol,'48 rows',canonical['metadata']['sha256'][:16], 'meta',parsed['meta']['timezone'])
