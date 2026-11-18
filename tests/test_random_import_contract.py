"""Reproducible, synthetic input-fuzz tests for source-locked MSAS data contracts.

No dependency or network: deterministic Python Random seeds, no provider-specific
assumptions. Valid examples must round-trip; invalid OHLC/duplicate times must
fail and must never be repaired by inventing missing data.
"""
from __future__ import annotations
import datetime as dt
import random
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'app'))
from importer import normalize


class TestRandomImportContract(unittest.TestCase):
    def test_randomized_valid_header_aliases_and_missing_volume(self):
        master=random.Random(20261118)
        for case in range(96):
            seed=master.randrange(2**32)
            rng=random.Random(seed)
            rows=[]; value=100+case
            for i in range(16):
                op=round(value,4)
                cl=round(op+rng.uniform(-2,2),4)
                hi=round(max(op,cl)+rng.uniform(.1,1.9),4)
                lo=round(min(op,cl)-rng.uniform(.1,1.9),4)
                rows.append((f'2025-06-18T{6+i//4:02d}:{(i%4)*15:02d}:00Z',op,hi,lo,cl))
                value=cl
            variant=case%3
            if variant==0:
                h='Timestamp,Open,High,Low,Close'
                cells=lambda row:row
            elif variant==1:
                h='timestamp,close,LOW,HIGH,OPEN'
                cells=lambda r:(r[0],r[4],r[3],r[2],r[1])
            else:
                h='Time,Open,High,Low,Close,Volume'
                cells=lambda r:(*r,'')
            text='\n'.join([h]+[','.join(str(v) for v in cells(row)) for row in rows])+'\n'
            with self.subTest(seed=seed,variant=variant):
                doc=normalize(text.encode('utf-8'),f'seed_{seed}.csv')
                self.assertEqual(len(doc['candles']),16)
                self.assertFalse(doc['meta']['volume_present'] if variant<2 else any(c.get('volume') is not None for c in doc['candles']))
                for src,candle in zip(rows,doc['candles']):
                    self.assertAlmostEqual(candle['open'],src[1],places=4)
                    self.assertAlmostEqual(candle['high'],src[2],places=4)
                    self.assertAlmostEqual(candle['low'],src[3],places=4)
                    self.assertAlmostEqual(candle['close'],src[4],places=4)
                    self.assertIsNone(candle.get('volume'))

    def test_random_corrupt_ohlc_is_rejected(self):
        rng=random.Random(20261119)
        for kind in ('high_below_body','low_above_body','duplicate_timestamp'):
            for i in range(24):
                op=round(100+rng.uniform(-5,5),4)
                cl=round(op+rng.uniform(-2,2),4)
                hi=max(op,cl)+1
                lo=min(op,cl)-1
                timestamp='2025-06-18T06:15:00Z'
                if kind=='high_below_body':hi=min(op,cl)-.01
                if kind=='low_above_body':lo=max(op,cl)+.01
                line=f'{timestamp},{op},{hi},{lo},{cl}'
                duplicate_time='2025-06-18T06:00:00Z' if kind=='duplicate_timestamp' else timestamp
                first='2025-06-18T06:00:00Z,100,102,98,101'
                text='Timestamp,Open,High,Low,Close\n'+first+'\n'+line.replace(timestamp,duplicate_time,1)+'\n'
                with self.subTest(kind=kind,index=i):
                    with self.assertRaises(Exception):
                        normalize(text.encode('utf-8'),f'bad_{kind}_{i}.csv')

if __name__=='__main__':unittest.main()
