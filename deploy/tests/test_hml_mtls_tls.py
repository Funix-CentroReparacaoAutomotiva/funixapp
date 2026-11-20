"""Real synthetic TLS boundary; root/systemd backend is deliberately isolated."""
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

SPEC=importlib.util.spec_from_file_location('transport',Path(__file__).resolve().parents[1]/'remote-hml/transport.py')
transport=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(transport)


class RealMtlsTest(unittest.TestCase):
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
