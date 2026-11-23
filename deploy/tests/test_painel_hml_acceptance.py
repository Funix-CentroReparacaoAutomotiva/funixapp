import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('pan_check', Path(__file__).resolve().parents[1] / 'painel-hml-acceptance.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeResponse:
    def __init__(self, code, headers, body):
        self.status = code
        self._headers = headers
        self._body = body
    def getheaders(self): return self._headers
    def read(self, n): return self._body[:n]


class FakeConnection:
    requests = []
    missing_auth = None
    def __init__(self, host, *, timeout, context):
        assert host == 'hml.funix.com.br'
        assert context.verify_mode is not None
    def request(self, method, path, headers):
        assert method == 'GET'
        self.headers = headers
        self.path = path
        FakeConnection.requests.append((path, headers))
    def getresponse(self):
        if 'Authorization' not in self.headers:
            if FakeConnection.missing_auth is not None:
                return FakeResponse(FakeConnection.missing_auth, [], b'PUBLIC')
            return FakeResponse(401, [('WWW-Authenticate', 'Basic realm="HML"')], b'')
        if self.path.endswith('snapshot.json'):
            payload=json.dumps({'schemaVersion': 1}).encode()
        else:
            payload = module.EXPECTED[self.path]
        return FakeResponse(200, [], payload)
    def close(self): pass


class AcceptanceTest(unittest.TestCase):
    def setUp(self):
        FakeConnection.requests.clear()
        FakeConnection.missing_auth = None
    def test_preflight_requires_401_all_routes(self):
        module.check('preflight', connector=FakeConnection)
        self.assertEqual(len(FakeConnection.requests), len(module.PATHS))
        self.assertTrue(all('Authorization' not in headers for _, headers in FakeConnection.requests))
    def test_accept_protects_and_reads_all_resources(self):
        module.check('accept', connector=FakeConnection, username='tester', password='secret')
        self.assertEqual(len(FakeConnection.requests), 2*len(module.PATHS))
    def test_public_route_is_blocked(self):
        FakeConnection.missing_auth = 200
        with self.assertRaisesRegex(ValueError, 'não bloqueado'):
            module.check('preflight', connector=FakeConnection)
    def test_credentials_mandatory_for_accept(self):
        with self.assertRaisesRegex(ValueError, 'Credenciais'):
            module.check('accept', connector=FakeConnection)
    def test_redirect_is_blocked(self):
        FakeConnection.missing_auth = 302
        with self.assertRaisesRegex(ValueError, 'HTTP 302'):
            module.check('preflight', connector=FakeConnection)

if __name__=='__main__': unittest.main()
