"""Generated CSV evidence is reproducible, valid and explicitly synthetic.

These are NOT human-annotated truth labels. Test ensures the examples shipped
for manual UI trials are not accidental mutations of source/provider datasets.
"""
from __future__ import annotations
import hashlib,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'app'))
from importer import normalize

class TestGeneratedFixtures(unittest.TestCase):
    def test_manifest_csv_hash_and_import(self):
        folder=ROOT/'fixtures/generated';meta=json.loads((folder/'manifest.json').read_text(encoding='utf8'))
        self.assertTrue(meta['synthetic'])
        self.assertTrue(meta['not_ground_truth'])
        self.assertEqual(len(meta['files']),24)
        types=set()
        for entry in meta['files']:
            with self.subTest(id=entry['id']):
                types.add(entry['type'])
                self.assertTrue(entry['is_synthetic'])
                raw=(folder/entry['filename']).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(),entry['sha256'])
                d=normalize(raw,entry['filename'])
                self.assertEqual(len(d['candles']),128)
                self.assertFalse(d['meta']['volume_present'])
                self.assertTrue(all(c['low']<=min(c['open'],c['close'])<=max(c['open'],c['close'])<=c['high'] for c in d['candles']))
        self.assertEqual(len(types),12)

if __name__=='__main__':unittest.main()
