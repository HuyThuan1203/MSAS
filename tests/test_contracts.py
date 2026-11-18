"""Pure-stdlib dataset contract tests; no Docker, pip or admin required."""
from __future__ import annotations
import csv,datetime as dt,hashlib,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'app'))
from importer import normalize

class TestContract(unittest.TestCase):
    def test_manifest_and_canonical(self):
        for symbol in ('BTCUSD','XAUUSD'):
            stem=f'{symbol}_M15_12h_2025-06-18_UTC'
            raw=ROOT/'samples/raw'/(stem+'.csv')
            canonical=ROOT/'samples/normalized'/(stem+'.json')
            meta=ROOT/'samples/normalized'/(stem+'.manifest.json')
            csvfile=ROOT/'samples/normalized'/(stem+'.csv')
            self.assertTrue(raw.exists())
            m=json.loads(meta.read_text('utf-8'))
            c=json.loads(canonical.read_text('utf-8'))
            source_bytes=raw.read_bytes()
            source_sha=hashlib.sha256(source_bytes).hexdigest()
            expected_sha=m['source_sha256']
            if source_sha!=expected_sha:
                if (b'\r\n' in source_bytes and
                    hashlib.sha256(source_bytes.replace(b'\r\n',b'\n')).hexdigest()==expected_sha):
                    self.fail(f'{raw.relative_to(ROOT)}: Git converted LF to CRLF; restore the two raw samples with git restore --source=HEAD --worktree -- samples/raw/ after pulling .gitattributes')
                self.fail(f'{raw.relative_to(ROOT)}: raw SHA-256 mismatch; investigate source integrity, never edit manifest to conceal changed bytes')
            self.assertEqual(c['metadata']['sha256'],m['source_sha256'])
            self.assertEqual(m['row_count'],48)
            self.assertEqual(len(c['candles']),48)
            self.assertEqual(c['schema_version'],'1.0.0')
            self.assertEqual(c['timestamp_role'],'candle_open')
            self.assertFalse(c['metadata']['is_synthetic'])
            self.assertEqual(c['timezone'],'UTC')
            self.assertFalse(c['metadata']['volume_present'])
            self.assertEqual(c['metadata']['observed_gaps'],0)
            self.assertEqual(c['metadata']['expected_interval_seconds'],900)
            stamps=[]
            for i,row in enumerate(c['candles']):
                self.assertEqual(row['index'],i)
                self.assertIsNone(row['volume'])
                self.assertTrue(row['low']<=min(row['open'],row['close'])<=max(row['open'],row['close'])<=row['high'])
                self.assertTrue(row['time'].endswith('Z'))
                stamps.append(dt.datetime.fromisoformat(row['time'].replace('Z','+00:00')))
            self.assertEqual({int((b-a).total_seconds()) for a,b in zip(stamps,stamps[1:])},{900})
            self.assertEqual(stamps[0],dt.datetime(2025,6,18,6,0,tzinfo=dt.timezone.utc))
            self.assertEqual(stamps[-1],dt.datetime(2025,6,18,17,45,tzinfo=dt.timezone.utc))
            with csvfile.open(encoding='utf-8',newline='') as fh:
                r=list(csv.DictReader(fh))
            self.assertEqual(len(r),48)
            self.assertEqual(list(r[0]),['timestamp_utc','open','high','low','close','volume'])
            self.assertTrue(all(row['volume']=='' for row in r))
            # User-facing ingestion adapter recognizes the canonical header too.
            normalized=normalize(csvfile.read_bytes(),csvfile.name)
            self.assertEqual(len(normalized['candles']),48)
            self.assertEqual(normalized['meta']['mapping_mode'],'header')
            self.assertFalse(normalized['meta']['volume_present'])

    def test_raw_csv_preserved_by_git_attributes(self):
        attributes=(ROOT/'.gitattributes').read_text(encoding='utf-8')
        self.assertIn('samples/raw/*.csv -text',attributes.splitlines())

    def test_source_integrity_and_schemas_parse(self):
        for f in (ROOT/'schemas').glob('*.json'):
            schema=json.loads(f.read_text('utf-8'))
            self.assertEqual(schema.get('$schema'),'https://json-schema.org/draft/2020-12/schema')
            self.assertIn('title',schema)
        self.assertEqual(len(list((ROOT/'schemas').glob('*.json'))),3)
        s=json.loads((ROOT/'fixtures/advanced_slide13_synthetic.json').read_text('utf-8'))
        self.assertTrue(s['is_synthetic'])
        self.assertTrue(s['not_market_data'])
        self.assertEqual(len(s['pivots']),14)
        for p in s['pivots']:
            self.assertGreater(p['structConfirmedAt'],p['index'])

    def test_audit_format(self):
        for sym in ('BTCUSD','XAUUSD'):
            doc=json.loads((ROOT/'audits'/f'{sym}_M15_12h_2025-06-18_UTC.audit.json').read_text('utf-8'))
            self.assertEqual(len(doc['timeline']),48)
            self.assertEqual(doc['source_timeframe'],'M15')
            self.assertEqual(doc['analysis_version'],'market_structure_advanced_v1_2')
            self.assertEqual(doc['model_provenance']['mss_tolerance'],0)
            self.assertIn('mss',doc)
            self.assertIn('cisd',doc)
            self.assertEqual(len(doc['timeline'])-1,doc['timeline'][-1]['at'])
            self.assertEqual(doc['source_sha256'],json.loads((ROOT/'samples/normalized'/f'{sym}_M15_12h_2025-06-18_UTC.manifest.json').read_text('utf-8'))['source_sha256'])
            self.assertTrue(all(e['at']<48 for e in doc['events']))
            for i,row in enumerate(doc['timeline']):
                self.assertEqual(row['at'],i)
                self.assertTrue(all(e['at']==i for e in row['eventsAt']))
                self.assertIn(row['external']['trend'],('up','down','unknown'))
                self.assertIn(row['internal']['trend'],('up','down','unknown'))

if __name__=='__main__':unittest.main()
