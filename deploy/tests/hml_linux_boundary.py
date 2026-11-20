"""Real Linux privilege boundary; hosted disposable runner ONLY.

Exact wrappers/sudoers/units, real transport, synthetic privileged backend.
Does not run the updater: its transaction is tested by the separate Docker job.
"""
import grp
import hashlib
import http.client
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import ssl
import subprocess
import time

SOURCE = Path(__file__).resolve().parents[1] / 'remote-hml'
USER = 'funix-hml-ops'
LIB = Path('/usr/local/lib/funix-hml-ops')
TLS = Path('/etc/funix-hml-ops')
STATE = Path('/var/lib/funix-hml-ops-rehearsal')
RULE = Path('/etc/sudoers.d/funix-hml-ops')
UNITS = ['funix-hml-ops-transport.service', 'funix-hml-ops-worker.service']
WRAPPERS = [Path('/usr/local/sbin') / name for name in
            ('funix-hml-ops-status', 'funix-hml-ops-request')]

# Deliberately synthetic backend at the fixed path required by exact wrappers.
# It proves uid/env and systemd dispatch, NOT authorization/updater semantics.
BACKEND = '''import json,os,subprocess,sys,time
from pathlib import Path
s=Path('/var/lib/funix-hml-ops-rehearsal')
base=dict(schema='funix-hml-ops/1',scope='funix-hml')
action=sys.argv[1:]
if action==['status']:
 print(json.dumps(dict(base,status='ok',uid=os.geteuid(),unsafe_env=any(x in os.environ for x in ('PYTHONPATH','HML_CANARY','LD_PRELOAD')))))
elif action==['dispatch']:
 if sys.stdin.buffer.read(4097)!=b'{"synthetic": true}':
  print(json.dumps(dict(base,status='blocked',reason='synthetic_denied')));sys.exit(1)
 subprocess.run(['/usr/bin/systemctl','start','--no-block','funix-hml-ops-worker.service'],check=True,capture_output=True)
 print(json.dumps(dict(base,status='queued')))
elif action==['worker']:
 with (s/'starts').open('a') as f: f.write('start\\n')
 (s/'identity').write_text(json.dumps(dict(uid=os.geteuid(),unsafe_env='HML_CANARY' in os.environ)))
 mode=(s/'mode').read_text()
 if mode=='sleep': time.sleep(60)
 if mode=='fail': sys.exit(23)
 (s/'done').write_text('done')
else: sys.exit(64)
'''


def run(*args, check=True, **kwargs):
    return subprocess.run(args, check=check, capture_output=True, timeout=30, **kwargs)


def absent_account():
    try: pwd.getpwnam(USER)
    except KeyError: pass
    else: raise RuntimeError('account already exists')
    try: grp.getgrnam(USER)
    except KeyError: return
    raise RuntimeError('group already exists')


def wait_for(predicate):
    deadline = time.monotonic() + 20
    while not predicate():
        if time.monotonic() > deadline: raise AssertionError('boundary deadline')
        time.sleep(.1)


def main():
    if os.geteuid() != 0 or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or os.environ.get('GITHUB_ACTIONS') != 'true':
        raise RuntimeError('hosted disposable root runner required')
    paths = [LIB, TLS, STATE, RULE, *WRAPPERS,
             *(Path('/etc/systemd/system') / unit for unit in UNITS)]
    absent_account()
    if any(os.path.lexists(p) for p in paths) or Path('/etc/funix-hml').exists():
        raise RuntimeError('installation already exists')
    systemd = Path('/proc/1/comm').read_text().strip() == 'systemd' and Path('/run/systemd/system').is_dir()
    if systemd:
        for unit in UNITS:
            assert run('systemctl','show',unit,'-p','LoadState','--value').stdout.strip() == b'not-found'
    account = False
    installed = []
    try:
        run('useradd','--system','--user-group','--no-create-home','--shell','/usr/sbin/nologin',USER)
        account = True
        group = grp.getgrnam(USER).gr_gid
        for directory in (LIB,TLS,STATE):
            directory.mkdir(mode=0o755 if directory==LIB else 0o700)
            installed.append(directory)
        (LIB/'rootctl.py').write_text(BACKEND)
        shutil.copyfile(SOURCE/'transport.py',LIB/'transport.py')
        for wrapper in WRAPPERS:
            shutil.copyfile(SOURCE/'structure'/wrapper.name,wrapper)
            installed.append(wrapper); wrapper.chmod(0o755)
        run('visudo','-cf',str(SOURCE/'structure'/RULE.name))
        shutil.copyfile(SOURCE/'structure'/RULE.name,RULE)
        installed.append(RULE); RULE.chmod(0o440)
        run('visudo','-cf',str(RULE))
        def as_user(*args, **kw): return run('runuser','-u',USER,'--',*args,**kw)
        status = json.loads(as_user('sudo','-n','--',str(WRAPPERS[0])).stdout)
        assert status['uid']==0 and not status['unsafe_env']
        cleared = json.loads(as_user('env','HML_CANARY=private','PYTHONPATH=/tmp',
                                    'sudo','-n','--',str(WRAPPERS[0])).stdout)
        assert not cleared['unsafe_env']
        for command in ([str(WRAPPERS[0]),'extra'],[str(WRAPPERS[1]),'extra'],
                        ['/usr/bin/id'],['HML_CANARY=private',str(WRAPPERS[0])],
                        ['-u','nobody','--',str(WRAPPERS[0])]):
            assert as_user('sudo','-n',*command,check=False).returncode != 0
        for wrapper in WRAPPERS:
            assert run(str(wrapper),'extra',check=False).returncode==64
        denied=as_user('sudo','-n','--',str(WRAPPERS[1]),input=b'{}',check=False)
        assert denied.returncode==1 and json.loads(denied.stdout)['status']=='blocked'
        groups=as_user('id','-nG').stdout.decode().split()
        assert groups==[USER],groups
        for path in (LIB,STATE,RULE,*WRAPPERS):
            assert as_user('test','-w',str(path),check=False).returncode!=0
        if Path('/var/run/docker.sock').exists():
            for access in ('-r','-w'):
                assert as_user('test',access,'/var/run/docker.sock',check=False).returncode!=0
        print('HML_REAL_SUDO_WRAPPERS_OK',flush=True)
        for unit in UNITS:
            path=Path('/etc/systemd/system')/unit
            shutil.copyfile(SOURCE/'structure'/unit,path); installed.append(path)
        run('systemd-analyze','verify',*(str(Path('/etc/systemd/system')/u) for u in UNITS))
        if not systemd:
            print('HML_SYSTEMD_RUNTIME_UNAVAILABLE_VM_REQUIRED',flush=True)
            return
        run('systemctl','daemon-reload')
        # Self-signed synthetic CA/server/client, trusted only by this fixture.
        run('openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
            '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost',
            '-keyout',str(TLS/'server.key'),'-out',str(TLS/'server.crt'))
        shutil.copyfile(TLS/'server.crt',TLS/'ca.crt')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
        config=dict(gateway='127.0.0.1',port=port,source='127.0.0.1',
                    client_fingerprint=hashlib.sha256(ssl.PEM_cert_to_DER_cert((TLS/'server.crt').read_text())).hexdigest())
        (TLS/'transport.json').write_text(json.dumps(config))
        TLS.chmod(0o750); os.chown(TLS,0,group)
        for p in TLS.iterdir(): p.chmod(0o640); os.chown(p,0,group)
        (STATE/'mode').write_text('success')
        run('systemctl','start',UNITS[0])
        wait_for(lambda: run('systemctl','is-active',UNITS[0],check=False).returncode==0)
        for field,value in [('User',USER),('Group',USER),('ProtectSystem','full'),('ProtectHome','yes'),('PrivateTmp','yes')]:
            assert run('systemctl','show',UNITS[0],'-p',field,'--value').stdout.decode().strip()==value
        assert run('systemctl','show',UNITS[1],'-p','Restart','--value').stdout.strip()==b'no'
        client=ssl.create_default_context(cafile=str(TLS/'ca.crt')); client.load_cert_chain(TLS/'server.crt',TLS/'server.key')
        def query_https(method):
            conn=http.client.HTTPSConnection('localhost',port,context=client,timeout=5)
            try:
                conn.request(method,'/v1/status' if method=='GET' else '/v1/update',
                             body=None if method=='GET' else '{"synthetic": true}',headers={'Content-Type':'application/json'})
                response=conn.getresponse(); return response.status,json.loads(response.read())
            finally: conn.close()
        wait_for(lambda: listening(port))
        assert query_https('GET')[0]==200
        assert query_https('POST')[0]==202
        wait_for(lambda: (STATE/'done').exists())
        wait_for(lambda: run('systemctl','is-active',UNITS[1],check=False).returncode!=0)
        assert (STATE/'starts').read_text().splitlines()==['start']
        assert json.loads((STATE/'identity').read_text())==dict(uid=0,unsafe_env=False)
        (STATE/'mode').write_text('fail')
        assert run('systemctl','start',UNITS[1],check=False).returncode!=0
        assert run('systemctl','show',UNITS[1],'-p','ExecMainStatus','--value').stdout.strip()==b'23'
        run('systemctl','reset-failed',UNITS[1])
        (STATE/'mode').write_text('sleep')
        run('systemctl','start','--no-block',UNITS[1])
        wait_for(lambda: len((STATE/'starts').read_text().splitlines())==3)
        run('systemctl','stop',UNITS[1])
        assert run('systemctl','is-active',UNITS[1],check=False).returncode!=0
        assert run('systemctl','show',UNITS[1],'-p','NRestarts','--value').stdout.strip()==b'0'
        # Inspect only metadata; never print raw journal messages.
        journal=run('journalctl','-u',UNITS[1],'-o','json','--no-pager').stdout
        assert journal.strip()
        run('systemctl','stop',UNITS[0])
        assert not listening(port)
        # Revocation of the dedicated sudo rule also denies both exact wrappers.
        RULE.unlink()
        for wrapper in WRAPPERS:
            assert as_user('sudo','-n','--',str(wrapper),check=False).returncode!=0
        print('HML_REAL_SYSTEMD_TRANSPORT_WORKER_SUSPENSION_OK',flush=True)
    finally:
        if systemd:
            for unit in UNITS:
                run('systemctl','stop',unit)
                assert run('systemctl','is-active',unit,check=False).returncode!=0
                run('systemctl','reset-failed',unit,check=False)
        for path in reversed(installed):
            if path.is_dir(): shutil.rmtree(path)
            else: path.unlink(missing_ok=True)
        if systemd: run('systemctl','daemon-reload')
        if account:
            run('userdel',USER)
            try: grp.getgrnam(USER)
            except KeyError: pass
            else: run('groupdel',USER)
        assert not any(os.path.lexists(p) for p in paths)
        absent_account()
        print('HML_LINUX_BOUNDARY_CLEANUP_OK',flush=True)


def listening(port):
    try:
        with socket.create_connection(('127.0.0.1',port),timeout=.2): return True
    except OSError: return False


if __name__=='__main__': main()
