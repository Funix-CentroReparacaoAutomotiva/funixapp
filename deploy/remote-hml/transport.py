"""Unprivileged bridge-only mTLS transport; two fixed root entrypoints."""
import hashlib
from http.server import BaseHTTPRequestHandler,HTTPServer
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess

TLS=Path('/etc/funix-hml-ops')
SCHEMA='funix-hml-ops/1'
STATUS='/usr/local/sbin/funix-hml-ops-status'
DISPATCH='/usr/local/sbin/funix-hml-ops-request'

def blocked(code):return {'schema':SCHEMA,'scope':'funix-hml','status':'blocked','reason':code}

class Server(HTTPServer):
    allow_reuse_address=True
    def __init__(self,config,ctx):
        self.source=config['source']; self.fp=config['client_fingerprint']; self.ctx=ctx
        super().__init__((config['gateway'],config['port']),Handler)
    def get_request(self):
        sock,addr=super().get_request(); sock.settimeout(8)
        try:
            if addr[0]!=self.source: raise PermissionError('wrong_origin')
            ss=self.ctx.wrap_socket(sock,server_side=True,do_handshake_on_connect=False)
            try:
                ss.do_handshake(); cert=ss.getpeercert(binary_form=True)
                if not cert or hashlib.sha256(cert).hexdigest()!=self.fp: raise PermissionError('wrong_certificate')
                return ss,addr
            except Exception: ss.close(); raise
        except Exception: sock.close(); raise OSError('connection_denied') from None
    def handle_error(self,*_): pass

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.0'
    server_version='FUNIX-HML-Ops'
    sys_version=''
    def log_message(self,*_): pass
    def send_error(self,code,message=None,explain=None): self.reply(code,blocked('http_request_denied'))
    def reply(self,code,payload):
        probe = os.environ.get('FUNIX_HML_MIGRATION_PROBE')
        if probe and code == 200 and self.command == 'GET':
            payload = dict(payload, migration_probe=probe)
        data=json.dumps(payload,separators=(',',':')).encode('utf-8')
        self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(data))); self.send_header('Cache-Control','no-store'); self.send_header('Connection','close'); self.end_headers(); self.wfile.write(data); self.close_connection=True
    def call(self,command,body=b''):
        try:
            r=subprocess.run(['/usr/bin/sudo','-n','--',command],input=body,capture_output=True,timeout=25)
            if r.stderr or len(r.stdout)>32768: raise ValueError('invalid_output')
            output=json.loads(r.stdout)
            if not isinstance(output,dict) or output.get('schema')!=SCHEMA or output.get('scope')!='funix-hml' or output.get('status') not in ('ok','queued','blocked'): raise ValueError('invalid_output')
            code=200 if r.returncode==0 and output['status']=='ok' else 202 if r.returncode==0 and output['status']=='queued' else 409 if r.returncode==1 and output['status']=='blocked' else 502
            self.reply(code,output if code!=502 else blocked('controller_contract'))
        except Exception: self.reply(503,blocked('controller_unavailable'))
    def do_GET(self):
        if self.path!='/v1/status' or self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length','0')!='0': return self.reply(404,blocked('route_denied'))
        self.call(STATUS)
    def do_POST(self):
        if os.environ.get('FUNIX_HML_MIGRATION_PROBE'):
            return self.reply(404,blocked('route_denied'))
        if self.path!='/v1/update': return self.reply(404,blocked('route_denied'))
        lengths=self.headers.get_all('Content-Length',[])
        if self.headers.get('Transfer-Encoding') or len(lengths)!=1 or not lengths[0].isdigit() or not 0<int(lengths[0])<=4096 or self.headers.get_content_type()!='application/json': return self.reply(400,blocked('request_body'))
        data=self.rfile.read(int(lengths[0]))
        if len(data)!=int(lengths[0]): return self.reply(400,blocked('request_body'))
        self.call(DISPATCH,data)

def main():
    os.umask(0o077)
    config=json.loads((TLS/'transport.json').read_text())
    ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.minimum_version=ssl.TLSVersion.TLSv1_2; ctx.verify_mode=ssl.CERT_REQUIRED
    ctx.load_cert_chain(TLS/'server.crt',TLS/'server.key'); ctx.load_verify_locations(cafile=str(TLS/'ca.crt'))
    with Server(config,ctx) as server: server.serve_forever(poll_interval=0.5)

if __name__=='__main__': main()
