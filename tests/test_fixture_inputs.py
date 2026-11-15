"""Provider adapter fixture set; stdlib only."""
from pathlib import Path
import sys,unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'app'))
from importer import normalize,DataError
F=ROOT/'fixtures/input_cases'
class TestFixtureInputs(unittest.TestCase):
    def test_valid_variations(self):
        for filename,mode,gaps in [('case_insensitive_reordered.csv','header',0),('headerless_five_columns.csv','position',0),('gap_m15.csv','header',1)]:
            with self.subTest(filename=filename):
                result=normalize((F/filename).read_bytes(),filename)
                self.assertEqual(len(result['candles']),4)
                self.assertIsNone(result['candles'][0]['volume'])
                self.assertEqual(result['meta']['mapping_mode'],mode)
                self.assertEqual(result['meta']['gaps'],gaps)
    def test_invalid_variations(self):
        for filename,code in [('invalid_ohlc.csv','INVALID_OHLC'),('duplicate_timestamp.csv','INVALID_TIMESTAMPS'),('mixed_timezone.csv','INVALID_DATA')]:
            with self.subTest(filename=filename):
                with self.assertRaises(DataError) as err:normalize((F/filename).read_bytes(),filename)
                self.assertEqual(err.exception.code,code)
