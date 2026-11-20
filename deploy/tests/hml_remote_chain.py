"""Disposable-runner chain using real transport/controller/worker/updater.

Only sudo/systemd invocation and host path/bootstrap binding are simulated.
Worker runs once in a forked process; official Docker transaction remains real.
This is NOT evidence of sudo policy or systemd isolation on the installed host.
"""
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import threading
import time
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'remote-hml'/(name+'.py'))
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


def run_chain(updater,config,previous,op,root,identity,fake_api):
    if os.geteuid()!=0 or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted':
        raise RuntimeError('disposable hosted root runner required')
    ctl,p,transport=load('rootctl'),load('control'),load('transport')
    state=Path(config['state']); ops=root/'ops'; ops.mkdir(mode=0o700)
    (ops/'requests').mkdir(mode=0o700); (ops/'control.lock').touch(mode=0o600)
    private=root/'prepare-private'; private.mkdir(mode=0o700)
    archive=op/'candidate.zip'
    shutil.copyfile(config['artifact_zip'],archive); archive.chmod(0o600)
    config['artifact_zip']=str(archive)
    (op/'config.json').write_text(json.dumps(config)); (op/'config.json').chmod(0o600)
    approval=dict(identity=identity,digest=hashlib.sha256(archive.read_bytes()).hexdigest(),
                  size=archive.stat().st_size,installed_revision=previous['revision'])
    (private/'approval.json').write_text(json.dumps(approval)); (private/'approval.json').chmod(0o600)
    (private/'github.token').write_text('github_pat_'+'x'*32); (private/'github.token').chmod(0o600)
    predecessor=state/'op-predecessor'; predecessor.mkdir(mode=0o700)
    old=predecessor/'operation.json'
    old.write_text(json.dumps(dict(schema=1,project='funix-hml',maintenance=True,phase='accepted',
                                   candidate=previous,previous=previous))); old.chmod(0o600)
    (state/'active.json').write_text(json.dumps({'journal':str(old)})); (state/'active.json').chmod(0o600)
    cert,key=root/'remote.crt',root/'remote.key'
    real_run=subprocess.run
    real_run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost',
              '-addext','subjectAltName=DNS:localhost','-keyout',str(key),'-out',str(cert)],check=True,capture_output=True)
    server_context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); server_context.verify_mode=ssl.CERT_REQUIRED
    server_context.load_cert_chain(cert,key); server_context.load_verify_locations(cafile=str(cert))
    client=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT); client.load_verify_locations(cafile=str(cert)); client.load_cert_chain(cert,key)
    def query(path,token):
        result=dict(fake_api(path))
        if path.startswith('actions/artifacts/'):
            result.update(id=identity['artifact_id'],size_in_bytes=approval['size'])
        return result
    def external():
        row=json.loads(subprocess.check_output(['docker','inspect',sentinel],text=True))[0]
        return {row['Id']:(row['State']['StartedAt'],row['RestartCount'])}
    def routed(args,**kwargs):
        if args[:3]==['/usr/bin/sudo','-n','--']:
            if args[3:]==[transport.STATUS]: result=ctl.status()
            elif args[3:]==[transport.DISPATCH]:
                try: result=ctl.dispatch(kwargs.get('input',b''))
                except ctl.Blocked as error:
                    return subprocess.CompletedProcess(args,1,json.dumps(transport.blocked(ctl.reason(error))).encode(),b'')
            else: return subprocess.CompletedProcess(args,1,b'',b'denied')
            return subprocess.CompletedProcess(args,0,json.dumps(result).encode(),b'')
        if args and args[0]=='/usr/bin/systemctl':
            if args[1:]==['show','--property=ActiveState','--value',ctl.WORKER]:
                return subprocess.CompletedProcess(args,0,'inactive','')
            if args[1:]==['start','--no-block',ctl.WORKER]:
                return subprocess.CompletedProcess(args,0,b'',b'')
            raise AssertionError('unexpected systemd command')
        return real_run(args,**kwargs)
    sentinel=subprocess.check_output(['docker','run','--detach','--network','none','--read-only',
        'python:3.12-alpine','python','-c','import time; time.sleep(600)'],text=True).strip()
    server=transport.Server(dict(gateway='127.0.0.1',port=0,source='127.0.0.1',
        client_fingerprint=hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert.read_text())).hexdigest()),server_context)
    thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
    def request(method,body=None,context=client,drop=False):
        connection=http.client.HTTPSConnection('localhost',server.server_port,context=context,timeout=10)
        try:
            connection.request(method,'/v1/update' if method=='POST' else '/v1/status',
                               body=json.dumps(body) if body is not None else None,headers={'Content-Type':'application/json'})
            if drop:
                connection.close(); return None
            response=connection.getresponse(); return response.status,json.loads(response.read())
        finally: connection.close()
    def worker(expected):
        pid=os.fork()
        if pid==0:
            try:
                result=ctl.worker(); os._exit(0 if result['status']=='accepted' else 1)
            except BaseException: os._exit(2)
        deadline=time.monotonic()+180
        while True:
            finished,status=os.waitpid(pid,os.WNOHANG)
            if finished: break
            if time.monotonic()>deadline:
                os.kill(pid,9); os.waitpid(pid,0); raise AssertionError('worker deadline')
            time.sleep(.1)
        result=request('GET')[1]['last_request']
        assert os.waitstatus_to_exitcode(status)==(0 if expected=='accepted' else 1),result
        assert result['status']==expected,result
    with patch.object(ctl,'ROOT',ops),patch.object(ctl,'prep_module',return_value=p), \
         patch.object(p,'STATE',state),patch.object(p,'PRIVATE',private), \
         patch.object(p,'load_updater',return_value=updater),patch.object(p,'query',side_effect=query), \
         patch.object(p,'external_snapshot',side_effect=external),patch.object(subprocess,'run',side_effect=routed):
        try:
            invalid=dict(action='update',operation=op.name,revision=identity['revision'],sha256=approval['digest'],ticket_id='0'*32)
            assert request('POST',invalid)[0]==409
            assert not (op/'operation.json').exists()
            assert request('POST',dict(invalid,command='id'))[0]==409
            no_client=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            no_client.load_verify_locations(cafile=str(cert))
            for context in (ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT),no_client):
                try: request('GET',context=context)
                except (OSError,ssl.SSLError,http.client.HTTPException): pass
                else: raise AssertionError('untrusted CA or missing client certificate accepted')
            for attr,bad in (('fp','0'*64),('source','192.0.2.1')):
                saved=getattr(server,attr); setattr(server,attr,bad)
                try:
                    try: request('GET')
                    except (OSError,ssl.SSLError,http.client.HTTPException): pass
                    else: raise AssertionError('invalid client accepted')
                finally: setattr(server,attr,saved)
            expired=ctl.approve(ctl.view()['preview_sha256'])
            ticket=ctl.read(ops/'armed.json'); ticket['issued_at']-=1300; ticket['expires_at']-=1300
            ctl.replace(ops/'armed.json',ticket)
            assert request('POST',expired['request'])[0]==409
            for path in (old,archive,op/'config.json'):
                armed=ctl.approve(ctl.view()['preview_sha256'])
                assert request('POST',armed['request'])[0]==202
                saved=path.read_bytes(); path.write_bytes(saved+b' ')
                worker('blocked_before_journal')
                assert not (op/'operation.json').exists()
                path.write_bytes(saved)
            preview=ctl.view(); armed=ctl.approve(preview['preview_sha256'])
            # A lost POST response must be reconciled by GET, never retried.
            request('POST',armed['request'],drop=True)
            deadline=time.monotonic()+10
            while not (ops/'current.json').exists() and time.monotonic()<deadline: time.sleep(.05)
            status=request('GET')[1]; assert status['last_request']['status']=='queued_or_interrupted'
            assert request('POST',armed['request'])[0]==409
            try: ctl.view()
            except ctl.Blocked: pass
            else: raise AssertionError('queued operation allowed new authorization')
            worker('accepted')
            final=request('GET')[1]
            assert final['last_request']['status']=='accepted',final
            assert final['journal']['phase']=='accepted' and final['journal']['candidate_revision']==identity['revision']
            print('HML_REMOTE_TLS_DISPATCH_WORKER_TRANSACTION_OK',flush=True)
        finally:
            server.shutdown(); server.server_close(); thread.join()
            real_run(['docker','rm','--force',sentinel],check=True,capture_output=True)
