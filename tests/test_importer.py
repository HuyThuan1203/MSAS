import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from importer import normalize, DataError

ROOT=Path(__file__).resolve().parents[1]

class TestImport(unittest.TestCase):
    def parse(self, s, name='provider.csv', **kw):
        return normalize(s.encode('utf-8') if isinstance(s,str) else s,name,**kw)

    def test_builtin_btc_xau(self):
        for file in (ROOT/'samples').glob('*.csv'):
            result=normalize(file.read_bytes(),file.name)
            self.assertEqual(len(result['candles']),40)
            self.assertEqual(result['meta']['timeframe'],'M15')
        xau=normalize((ROOT/'samples/XAUUSD_M15_10Hours.csv').read_bytes(),'XAUUSD.csv')
        self.assertFalse(xau['meta']['volume_present'])
        self.assertIsNone(xau['candles'][0]['volume'])
        self.assertEqual(xau['meta']['gaps'],1)
        self.assertEqual(xau['candles'][0]['time'],'2026-11-11 15:00:00+00:00')

    def test_case_insensitive_reordered_columns(self):
        x='close;timestamp;LOW;HIGH;open\n3.1;2026-11-11 08:00;2.0;5.0;3.0\n4.0;2026-11-11 08:15;3.3;4.6;3.5\n5.0;2026-11-11 08:30;3.9;5.2;4.1'
        d=self.parse(x)
        self.assertEqual(d['candles'][0]['open'],3.)
        self.assertEqual(d['candles'][2]['close'],5.)
        self.assertEqual(d['meta']['mapping_mode'],'header')

    def test_headerless_positional(self):
        x='2026-11-11 00:00:00,10,11,9,10.5\n2026-11-11 00:15:00,10.5,12,10,11.5\n2026-11-11 00:30:00,11.5,13,11,12'
        d=self.parse(x)
        self.assertEqual(len(d['candles']),3)
        self.assertEqual(d['meta']['mapping_mode'],'position')

    def test_generic_headers_positional(self):
        x='col1,col2,col3,col4,col5\n2026-11-11 00:00,10,11,9,10.5\n2026-11-11 00:15,11,12,10,11.5'
        self.assertEqual(self.parse(x)['meta']['mapping_mode'],'position')

    def test_separate_date_and_time(self):
        x='<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\n2026.11.11\t10:00:00\t100\t105\t95\t102\t55\n2026.11.11\t10:15:00\t102\t108\t99\t106\t56'
        d=self.parse(x,'mt5.tsv')
        self.assertEqual(d['meta']['mapping']['timestamp'],'0+1')
        self.assertEqual(d['candles'][0]['time'],'2026-11-11 10:00:00')
        self.assertTrue(d['meta']['volume_present'])

    def test_decimal_comma_semicolon(self):
        x='Datetime;Open;High;Low;Close\n2026-11-11 09:00;101,2;102,5;100,9;101,8\n2026-11-11 09:15;101,8;103,5;100,8;102,3'
        d=self.parse(x)
        self.assertEqual(d['candles'][0]['open'],101.2)

    def test_utf16_and_bom(self):
        x='TIME,OPEN,HIGH,LOW,CLOSE\n2026-11-11 00:00,10,11,9,10.5'
        self.assertEqual(self.parse(x.encode('utf-16'))['candles'][0]['close'],10.5)

    def test_order_reversed_is_explicit(self):
        x='Time,Open,High,Low,Close\n2026-11-11 00:30,12,13,11,12\n2026-11-11 00:15,11,12,10,11\n2026-11-11 00:00,10,11,9,10'
        d=self.parse(x)
        self.assertEqual(d['candles'][0]['open'],10.)
        self.assertTrue(any('ĐẢO' in w for w in d['warnings']))

    def test_gaps_do_not_create_candles(self):
        x='Time,Open,High,Low,Close\n2026-11-11 00:00,10,11,9,10\n2026-11-11 00:15,10,11,9,10\n2026-11-11 01:00,10,11,9,10'
        d=self.parse(x)
        self.assertEqual(len(d['candles']),3)
        self.assertEqual(d['meta']['gaps'],1)

    def test_manual_mapping(self):
        x='alpha,beta,gamma,delta,epsilon,zeta,eta\nBTC,2026-11-11 00:00,5,7,4,6,99\nBTC,2026-11-11 00:15,6,8,5,7,80'
        with self.assertRaises(DataError) as ctx:
            self.parse(x)
        self.assertEqual(ctx.exception.code,'NEEDS_MAPPING')
        m={'timestamp':1,'open':2,'high':3,'low':4,'close':5,'volume':6}
        d=self.parse(x,mapping=m)
        self.assertEqual(d['candles'][0]['high'],7)
        self.assertEqual(d['candles'][0]['volume'],99)

    def test_invalid_ohlc_rejected(self):
        x='Timestamp,Open,High,Low,Close\n2026-11-11 00:00,10,9,8,10'
        with self.assertRaises(DataError) as ctx: self.parse(x)
        self.assertEqual(ctx.exception.code,'INVALID_OHLC')

    def test_duplicate_timestamp_rejected(self):
        x='Timestamp,Open,High,Low,Close\n2026-11-11 00:00,10,11,9,10\n2026-11-11 00:00,10,11,9,10'
        with self.assertRaises(DataError) as ctx: self.parse(x)
        self.assertEqual(ctx.exception.code,'INVALID_TIMESTAMPS')

    def test_ambiguous_dmy_mdy_explicit(self):
        x='Timestamp,Open,High,Low,Close\n11/12/2026 10:00,10,11,9,10'
        with self.assertRaises(DataError) as ctx: self.parse(x)
        self.assertEqual(ctx.exception.code,'DATE_ORDER_REQUIRED')
        self.assertEqual(self.parse(x,date_order='MDY')['candles'][0]['time'][:10],'2026-11-12')
        self.assertEqual(self.parse(x,date_order='DMY')['candles'][0]['time'][:10],'2026-12-11')

    def test_json_and_jsonl(self):
        content=[{'DateTime':'2026-11-11 00:00','openingPrice':10,'highestPrice':11,'lowestPrice':9,'closingPrice':10.5},
                 {'DateTime':'2026-11-11 00:15','openingPrice':10.5,'highestPrice':12,'lowestPrice':10,'closingPrice':11.5}]
        d=self.parse(json.dumps({'data':content}),'sample.json')
        self.assertEqual(len(d['candles']),2)
        text='\n'.join(json.dumps(c) for c in content)
        self.assertEqual(len(self.parse(text,'sample.jsonl')['candles']),2)

    def test_xlsx_common_case(self):
        # Construct a basic XLSX sheet with stdlib only; no openpyxl dependency.
        from zipfile import ZipFile, ZIP_DEFLATED
        import xml.sax.saxutils
        ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
        rows=[['timestamp','Open','High','Low','Close'],
              ['2026-11-11 10:00',10,12,8,11],
              ['2026-11-11 10:15',11,13,10,12]]
        items=[]
        for ri,row in enumerate(rows,1):
            cells=[]
            for ci,item in enumerate(row):
                addr=chr(65+ci)+str(ri)
                if isinstance(item,str):
                    cells.append(f'<c r="{addr}" t="inlineStr"><is><t>{xml.sax.saxutils.escape(item)}</t></is></c>')
                else:
                    cells.append(f'<c r="{addr}"><v>{item}</v></c>')
            items.append(f'<row r="{ri}">{"".join(cells)}</row>')
        worksheet=f'<worksheet xmlns="{ns}"><sheetData>{"".join(items)}</sheetData></worksheet>'
        buffer=io.BytesIO()
        with ZipFile(buffer,'w',compression=ZIP_DEFLATED) as z:
            z.writestr('xl/worksheets/sheet1.xml',worksheet)
        d=self.parse(buffer.getvalue(),'sample.xlsx')
        self.assertEqual(len(d['candles']),2)
        self.assertEqual(d['candles'][1]['close'],12)

    def test_no_guess_when_invalid_five_field_rows(self):
        x='foo,bar,baz,quux,quuz\n2026-11-11 00:00,10,8,9,10'
        with self.assertRaises(DataError) as ctx: self.parse(x)
        self.assertEqual(ctx.exception.code,'INVALID_OHLC')

if __name__=='__main__': unittest.main(verbosity=2)
