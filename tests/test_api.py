"""Real HTTP integration tests for Docker's standalone server (no Docker daemon needed)."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT=Path(__file__).resolve().parents[1]
SAMPLE=(ROOT/'samples'/'XAUUSD_M15_10Hours.csv').read_bytes()

class TestServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        sock=socket.socket();sock.bind(('127.0.0.1',0));cls.port=sock.getsockname()[1];sock.close()
        cls.env={**os.environ,'DATA_DIR':cls.tmp.name,'HOST':'127.0.0.1','PORT':str(cls.port)}
        cls.proc=subprocess.Popen([sys.executable,'-u','app/server.py'],cwd=str(ROOT),env=cls.env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        for _ in range(35):
            try:
                cls.request('/api/health')
                break
            except URLError:time.sleep(.1)
        else:
            raise RuntimeError('Test server did not start')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=4)
        cls.proc.stderr.close()
        cls.tmp.cleanup()

    @classmethod
    def request(cls,path,method='GET',body=None):
        with urlopen(Request(f'http://127.0.0.1:{cls.port}'+path,data=body,method=method),timeout=5) as response:
            return response.status,json.load(response)

    def test_two_builtin_datasets(self):
        _,data=self.request('/api/datasets')
        self.assertEqual(len(data['datasets']),4)
        for name,expected in [('btcusd-sample',40),('xauusd-sample',40),('btcusd-20250618',48),('xauusd-20250618',48)]:
            status,payload=self.request('/api/datasets/'+name)
            self.assertEqual(status,200)
            self.assertEqual(len(payload['candles']),expected)

    def test_upload_persists_and_delete(self):
        query=urlencode({'filename':'XAUUSD M15 10Hours.csv','label':'XAU run'})
        status,data=self.request('/api/import?'+query,'POST',SAMPLE)
        self.assertEqual(status,201)
        identifier=data['dataset']['id']
        self.assertEqual(len(data['candles']),40)
        self.assertFalse(data['meta']['volume_present'])
        status,result=self.request('/api/datasets/'+identifier)
        self.assertEqual(status,200)
        self.assertEqual(result['meta']['mapping_mode'],'header')
        self.assertEqual(len(result['candles']),40)
        status,result=self.request('/api/datasets/'+identifier,'DELETE')
        self.assertEqual(status,200)
        with self.assertRaises(HTTPError) as ctx:self.request('/api/datasets/'+identifier)
        self.assertEqual(ctx.exception.code,404)

    def test_invalid_ohlc_rejected_not_saved(self):
        body=b'Timestamp,Open,High,Low,Close\n2026-11-11 00:00,10,8,9,10'
        before=len(list(Path(self.tmp.name).glob('*.json')))
        with self.assertRaises(HTTPError) as ctx:self.request('/api/import?filename=broken.csv','POST',body)
        self.assertEqual(ctx.exception.code,422)
        err=json.loads(ctx.exception.read())
        self.assertEqual(err['code'],'INVALID_OHLC')
        self.assertEqual(len(list(Path(self.tmp.name).glob('*.json'))),before)

    def test_needs_mapping_and_manual_correct(self):
        body=b'junk,timecol,opencol,highcol,lowcol,closecol,another\nX,2026-11-11 00:00,20,25,19,22,3'
        with self.assertRaises(HTTPError) as ctx:self.request('/api/import?filename=unknown.csv','POST',body)
        self.assertEqual(ctx.exception.code,422)
        self.assertEqual(json.loads(ctx.exception.read())['code'],'NEEDS_MAPPING')
        mapping={'timestamp':1,'open':2,'high':3,'low':4,'close':5}
        query=urlencode({'filename':'unknown.csv','mapping':json.dumps(mapping)})
        status,data=self.request('/api/import?'+query,'POST',body)
        self.assertEqual(status,201)
        self.assertEqual(data['candles'][0]['close'],22)
        self.request('/api/datasets/'+data['dataset']['id'],'DELETE')

    def test_builtin_cannot_be_deleted(self):
        with self.assertRaises(HTTPError) as ctx:self.request('/api/datasets/btcusd-sample','DELETE')
        self.assertEqual(ctx.exception.code,403)

    def test_static_and_path_guard(self):
        with urlopen(f'http://127.0.0.1:{self.port}/',timeout=5) as response:
            self.assertIn('text/html',response.headers['Content-Type'])
            self.assertIn(b'Market structure',response.read())
        with self.assertRaises(HTTPError):
            self.request('/api/datasets/../../something')

if __name__=='__main__':unittest.main(verbosity=2)
