"""Real synthetic TLS boundary; root/systemd backend is deliberately isolated."""
import hashlib
import http.client
import importlib.util
import json
import os
import sys
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

SPEC=importlib.util.spec_from_file_location('transport',Path(__file__).resolve().parents[1]/'remote-hml/transport.py')
transport=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(transport)
COLLECTOR=importlib.util.spec_from_file_location('collector',Path(__file__).resolve().parents[1]/'remote-hml/collect-migration-proof.py')
collector=importlib.util.module_from_spec(COLLECTOR); COLLECTOR.loader.exec_module(collector)


class RealMtlsTest(unittest.TestCase):
    def test_collect_migration_proof_over_real_tls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cert, key = root/'server.crt', root/'client.key'
            subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
                            '-subj','/CN=fixture','-addext','subjectAltName=IP:127.0.0.1',
                            '-keyout',str(key),'-out',str(cert)],check=True,capture_output=True)
            key.chmod(0o600)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.verify_mode = ssl.CERT_REQUIRED
            context.load_cert_chain(cert,key)
            context.load_verify_locations(cafile=cert)
            fingerprint = hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert.read_text())).hexdigest()
            server = transport.Server(dict(source='127.0.0.1', gateway='127.0.0.1',
                                           port=0, client_fingerprint=fingerprint),context)
            thread = threading.Thread(target=server.serve_forever,daemon=True)
            thread.start()
            status = dict(schema='funix-hml-ops/1',scope='funix-hml',status='ok',
                          armed=None,last_request=None,journal={'phase':'accepted'})
            def fetch(probe=True):
                return collector.collect('127.0.0.1',cert,cert,key,probe=probe,port=server.server_port)

            def invoke(mode):
                # Change only the port for the disposable socket, and exercise CLI output handling.
                code = (
                    'import functools,runpy,sys; '
                    'm=runpy.run_path(sys.argv.pop(1)); '
                    'g=m["main"].__globals__; '
                    'g["collect"]=functools.partial(g["collect"],port=int(sys.argv.pop(1))); '
                    'm["main"]()'
                )
                with subprocess.Popen(
                        [sys.executable,'-I','-c',code,collector.__file__,str(server.server_port),
                         mode,'127.0.0.1',str(cert),str(cert),str(key)],
                        stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=os.environ.copy()) as process:
                    out, err = process.communicate(timeout=10)
                    return process.returncode, out, err
            try:
                backend = Mock(returncode=0,stderr=b'',stdout=json.dumps(status).encode())
                with patch.object(transport.subprocess,'run',return_value=backend) as dispatch:
                    self.assertEqual(json.loads(fetch(probe=False)),status)
                    self.assertEqual(invoke('status'),(0,b'HML mTLS status verified\n',b''))
                    with self.assertRaisesRegex(ValueError,'challenge'):
                        fetch()
                    with patch.dict(transport.os.environ,FUNIX_HML_MIGRATION_PROBE='a'*64):
                        self.assertEqual(json.loads(fetch()),dict(status,migration_probe='a'*64))
                        self.assertEqual(json.loads(invoke('probe')[1]),dict(status,migration_probe='a'*64))
                        with self.assertRaisesRegex(ValueError,'normal transport'):
                            fetch(probe=False)
                        backend.stdout = json.dumps(dict(status,armed={'sentinel':'private'})).encode()
                        with self.assertRaisesRegex(ValueError,'operational state'):
                            fetch()
                        self.assertEqual(invoke('probe'),(
                            1,b'',b'BLOCKED: HML mTLS status or evidence unavailable\n'))
                    with patch.dict(transport.os.environ,FUNIX_HML_MIGRATION_PROBE='invalid'):
                        backend.stdout = json.dumps(status).encode()
                        with self.assertRaisesRegex(ValueError,'challenge'):
                            fetch()
                    server.fp = '0'*64
                    with self.assertRaises((ssl.SSLError,OSError,http.client.HTTPException)):
                        fetch()
                    self.assertTrue(all(call.args[0][-1] == transport.STATUS
                                        for call in dispatch.call_args_list))
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_real_handshake_origin_fingerprint_and_no_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); cert=root/'cert.pem'; key=root/'key.pem'
            subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
                '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost',
                '-keyout',str(key),'-out',str(cert)],check=True,capture_output=True)
            server_context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_context.verify_mode=ssl.CERT_REQUIRED
            server_context.minimum_version=ssl.TLSVersion.TLSv1_2
            server_context.load_cert_chain(cert,key); server_context.load_verify_locations(cafile=str(cert))
            der=ssl.PEM_cert_to_DER_cert(cert.read_text())
            config=dict(source='127.0.0.1',client_fingerprint=hashlib.sha256(der).hexdigest(),gateway='127.0.0.1',port=0)
            server=transport.Server(config,server_context)
            thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
            trusted=ssl.create_default_context(cafile=str(cert)); trusted.load_cert_chain(cert,key)
            def request(context,method='GET',path='/v1/status'):
                connection=http.client.HTTPSConnection('localhost',server.server_port,context=context,timeout=2)
                try:
                    connection.request(method,path,body=b'{}' if method=='POST' else None,
                                       headers={'Content-Type':'application/json'})
                    response=connection.getresponse(); return response.status,json.loads(response.read())
                finally: connection.close()
            try:
                blocked=json.dumps(transport.blocked('approval_required')).encode()
                with patch.object(transport.subprocess,'run',return_value=Mock(returncode=1,stdout=blocked,stderr=b'')) as backend:
                    self.assertEqual(request(trusted,'POST','/v1/update')[0],409)
                    self.assertEqual(backend.call_count,1)
                    for context in (ssl.create_default_context(),ssl.create_default_context(cafile=str(cert))):
                        with self.assertRaises((ssl.SSLError,OSError,http.client.HTTPException)):
                            request(context)
                    for attribute,value in (('fp','0'*64),('source','192.0.2.1')):
                        old=getattr(server,attribute); setattr(server,attribute,value)
                        with self.assertRaises((ssl.SSLError,OSError,http.client.HTTPException)):
                            request(trusted)
                        setattr(server,attribute,old)
                    self.assertEqual(backend.call_count,1)
            finally:
                server.shutdown(); server.server_close(); thread.join()
