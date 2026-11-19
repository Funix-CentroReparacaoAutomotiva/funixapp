"""Administrative, first-install only. Does not authorize, dispatch or deploy."""
import base64
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time

BASE=Path('/usr/local/lib/funix-hml-ops'); STATE=Path('/var/lib/funix-hml-ops'); TLS=Path('/etc/funix-hml-ops')
USER='funix-hml-ops'; PORT=18443
SERVICE='funix-hml-ops-transport.service'; WORKER='funix-hml-ops-worker.service'
STATUS=Path('/usr/local/sbin/funix-hml-ops-status'); REQUEST=Path('/usr/local/sbin/funix-hml-ops-request')
SUDO=Path('/etc/sudoers.d/funix-hml-ops'); UNIT=Path('/etc/systemd/system')
step='start'
class Blocked(Exception): pass

def require(ok,code):
    if not ok: raise Blocked(code)

def output(key,v): print(key,json.dumps(v,ensure_ascii=True,sort_keys=True),flush=True)
def exists(p): return p.exists() or p.is_symlink()
def rooted(p):
    s=p.lstat(); require(p.resolve(strict=True)==p and s.st_uid==0 and not s.st_mode&0o022,'root_path'); return s

def put(p,b,mode,group=0):
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    with os.fdopen(fd,'wb') as f: os.fchown(f.fileno(),0,group); os.fchmod(f.fileno(),mode); f.write(b); f.flush(); os.fsync(f.fileno())

def run(*args,timeout=90,input=None):
    r=subprocess.run(args,input=input,capture_output=True,timeout=timeout)
    require(r.returncode==0,'command_failed'); return r.stdout.decode('utf-8').strip()

def set_dir(p,mode,group=0): p.mkdir(mode=mode); os.chown(p,0,group); os.chmod(p,mode)

def matches_origin(user):
    info=pwd.getpwnam(user); auth=Path(info.pw_dir)/'.ssh/authorized_keys'; require(auth.resolve(strict=True)==auth and auth.is_file(),'authorized_keys')
    rows=[x for x in auth.read_text().splitlines() if x.strip() and not x.lstrip().startswith('#')]
    require(len(rows)==1,'authorized_keys_count')
    m=re.findall(r'(?:^|,)from="([0-9./]+)"(?=,|\s)',rows[0]); require(len(m)==1,'source_limit')
    n=ipaddress.ip_network(m[0],strict=False); require(n.version==4 and n.num_addresses==1 and n.network_address.is_private and not n.network_address.is_loopback,'private_origin')
    return str(n.network_address)

def network():
    source=matches_origin('funix-hml-ro'); require(source==matches_origin('funix-hml-prep'),'origin_difference')
    ids=run('/usr/bin/docker','ps','-q').split(); require(ids,'container_list')
    rows=json.loads(run('/usr/bin/docker','inspect',*ids)); found=[]
    for row in rows:
        for name,detail in row.get('NetworkSettings',{}).get('Networks',{}).items():
            if detail.get('IPAddress')==source: found.append((row,name,detail))
    require(len(found)==1,'unique_origin'); row,name,detail=found[0]
    require(re.search(r'(?:^|/)n8n(?:[:@]|$)',row['Config']['Image']) is not None,'origin_not_n8n')
    ns=json.loads(run('/usr/bin/docker','network','inspect',name)); require(len(ns)==1,'network_count'); n=ns[0]
    require(n['Driver']=='bridge' and set(n.get('Containers',{}))=={row['Id']},'exclusive_bridge')
    src=ipaddress.ip_address(source)
    subnets=[(ipaddress.ip_network(v['Subnet'],strict=False),ipaddress.ip_address(v['Gateway'])) for v in n['IPAM']['Config'] if 'Subnet' in v and 'Gateway' in v and ':' not in v['Subnet']]
    matches=[gw for subnet,gw in subnets if src in subnet and gw in subnet]
    require(len(matches)==1,'bridge_subnet'); gw=matches[0]
    require(gw.version==4 and gw.is_private and not gw.is_loopback and gw!=src and detail.get('Gateway','') in ('',str(gw)),'bridge_gateway')
    ipdata=json.loads(run('ip','-j','address','show'))
    interface=n.get('Options',{}).get('com.docker.network.bridge.name') or 'br-'+n['Id'][:12]
    require(any(d.get('ifname')==interface and any(v.get('local')==str(gw) for v in d.get('addr_info',[])) for d in ipdata),'gateway_not_local_bridge')
    return source,str(gw)

def listeners():
    return [x.split()[3] for x in run('ss','-H','-ltn').splitlines() if len(x.split())>=4 and x.split()[3].endswith(':'+str(PORT))]

def certs(d,gateway):
    """Issue one server and one client leaf; CA private key stays in temporary directory."""
    def call(*args): return run('openssl',*args,timeout=90)
    ca=d/'ca.crt'; cak=d/'ca.key'; srv=d/'server.crt'; srk=d/'server.key'; cli=d/'client.crt'; clk=d/'client.key'
    call('req','-x509','-newkey','rsa:3072','-nodes','-sha256','-keyout',str(cak),'-out',str(ca),'-days','365','-subj','/CN=FUNIX HML Operations dedicated CA','-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign')
    for name,key,crt,ext in [('server',srk,srv,'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:'+gateway+'\n'),('client',clk,cli,'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n')]:
        csr=d/(name+'.csr'); e=d/(name+'.ext'); e.write_text(ext)
        call('req','-new','-newkey','rsa:2048','-nodes','-sha256','-keyout',str(key),'-out',str(csr),'-subj','/CN=FUNIX HML Operations '+name)
        call('x509','-req','-in',str(csr),'-CA',str(ca),'-CAkey',str(cak),'-CAcreateserial','-out',str(crt),'-days','180','-sha256','-extfile',str(e))
    call('verify','-CAfile',str(ca),'-purpose','sslserver','-verify_ip',gateway,str(srv))
    call('verify','-CAfile',str(ca),'-purpose','sslclient',str(cli))
    # ssl loads these pairs as an additional key/certificate consistency check.
    import ssl
    c=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); c.load_cert_chain(srv,srk)
    c=ssl.create_default_context(cafile=str(ca)); c.load_cert_chain(cli,clk)
    fp=hashlib.sha256(ssl.PEM_cert_to_DER_cert(cli.read_text())).hexdigest()
    return fp

def wrap(action):
    return ('#!/bin/sh\nset -eu\n[ "$#" -eq 0 ] || exit 64\nexec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root /usr/bin/python3 -I /usr/local/lib/funix-hml-ops/rootctl.py '+action+'\n').encode()

def main():
    global step
    os.umask(0o077); require(os.geteuid()==0,'root_only')
    require(not any(k.startswith(('DOCKER_','COMPOSE_')) for k in os.environ),'docker_environment_override')
    source=Path(__file__).resolve().parent
    paths=[source/'rootctl.py',source/'transport.py']
    for path in paths:
        info=rooted(path)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink==1,'source_file')
    rootbytes=paths[0].read_bytes(); trbytes=paths[1].read_bytes()
    code=compile(rootbytes,'rootctl.py','exec'); compile(trbytes,'transport.py','exec')
    root={'__name__':'funix_hml_install'}; exec(code,root)
    step='existing_prepared_candidate'; p,u,a,token,op,cfg,j,rec,previous,preview=root['context']()
    before=p.external_snapshot(); require(u.installed_preflight(u.make_adapter(cfg))==previous,'installed_release')
    output('PREPARADO',{'operation':op.name,'revision':preview['revision'],'installed_revision':preview['installed_revision'],'official_code_verified':True})
    step='exclusive_bridge'; source,gateway=network(); require(not listeners(),'port_in_use')
    output('REDE',{'exclusive_n8n_bridge':True,'internal_only':True,'port':PORT,'url':'https://'+gateway+':'+str(PORT)})
    step='exclusive_install_paths'
    for path in (BASE,STATE,TLS,STATUS,REQUEST,SUDO,UNIT/SERVICE,UNIT/WORKER): require(not exists(path),'target_exists')
    for path in (BASE.parent,STATE.parent,TLS.parent,STATUS.parent,SUDO.parent,UNIT): require(stat.S_ISDIR(rooted(path).st_mode),'unsafe_parent')
    try: pwd.getpwnam(USER)
    except KeyError: pass
    else: raise Blocked('account_exists')
    for prog in ('openssl','systemctl','visudo','sudo','useradd','runuser','ss','ip'): require(shutil.which(prog) is not None,'required_program_missing')
    require(shutil.which('systemctl')=='/usr/bin/systemctl' and Path('/usr/bin/sudo').is_file(),'system_paths')
    # No live approval is created here. New paths only; preserve all SSH/n8n/HML settings.
    step='service_identity'; run('useradd','--system','--user-group','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin',USER)
    usr=pwd.getpwnam(USER); require(run('id','-Gn',USER).split()==[USER] and run('passwd','-S',USER).split()[1] in ('L','LK'),'service_privileges')
    step='install_files'; set_dir(BASE,0o755); set_dir(STATE,0o700); set_dir(STATE/'requests',0o700); set_dir(STATE/'client-export',0o700); set_dir(TLS,0o750,usr.pw_gid)
    put(STATE/'control.lock',b'',0o600); put(BASE/'rootctl.py',rootbytes,0o644); put(BASE/'transport.py',trbytes,0o644)
    with tempfile.TemporaryDirectory(prefix='funix-hml-ops-pki-',dir=STATE) as tmp:
        d=Path(tmp); fp=certs(d,gateway)
        for name in ('ca.crt','server.crt','server.key'): put(TLS/name,(d/name).read_bytes(),0o640,usr.pw_gid)
        for name in ('ca.crt','client.crt','client.key'): put(STATE/'client-export'/name,(d/name).read_bytes(),0o600)
    put(TLS/'transport.json',json.dumps({'source':source,'gateway':gateway,'port':PORT,'client_fingerprint':fp},sort_keys=True).encode()+b'\n',0o640,usr.pw_gid)
    put(STATUS,wrap('status'),0o755); put(REQUEST,wrap('dispatch'),0o755)
    step='sudo_rules'; tmp=STATE/'sudoers.check'
    put(tmp,(f'{USER} ALL=(root) NOPASSWD: {STATUS} "", {REQUEST} ""\n').encode(),0o440)
    run('visudo','-cf',str(tmp)); put(SUDO,tmp.read_bytes(),0o440); tmp.unlink(); run('visudo','-c')
    step='systemd_units';
    svc='''[Unit]
Description=FUNIX HML restricted mTLS administrative bridge
After=docker.service network-online.target
Wants=network-online.target
[Service]
Type=simple
User=funix-hml-ops
Group=funix-hml-ops
ExecStart=/usr/bin/python3 -I /usr/local/lib/funix-hml-ops/transport.py
Restart=on-failure
RestartSec=3s
UMask=0077
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
[Install]
WantedBy=multi-user.target
'''
    worker='''[Unit]
Description=FUNIX HML explicitly approved official update worker
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root /usr/bin/python3 -I /usr/local/lib/funix-hml-ops/rootctl.py worker
TimeoutStartSec=infinity
UMask=0077
Restart=no
'''
    put(UNIT/SERVICE,svc.encode(),0o644); put(UNIT/WORKER,worker.encode(),0o644)
    step='negative_and_readonly_checks'; result=json.loads(run('runuser','-u',USER,'--','sudo','-n','--',str(STATUS)))
    require(result.get('status')=='ok' and result.get('armed') is None and result.get('last_request') is None and result.get('journal',{}).get('operation')==j.parent.name,'status_contract')
    denied=subprocess.run(['runuser','-u',USER,'--','sudo','-n','--','/usr/bin/id'],capture_output=True,timeout=15); require(denied.returncode!=0,'arbitrary_sudo_allowed')
    req={'action':'update','operation':op.name,'revision':preview['revision'],'sha256':preview['sha256'],'ticket_id':'0'*32}
    denied=subprocess.run(['runuser','-u',USER,'--','sudo','-n','--',str(REQUEST)],input=json.dumps(req).encode(),capture_output=True,timeout=25)
    require(denied.returncode==1 and json.loads(denied.stdout).get('reason')=='approval_required','update_without_approval_not_rejected')
    require(not exists(STATE/'armed.json') and not exists(STATE/'current.json'),'unexpected_request_state')
    output('CONTROLES',{'arbitrary_sudo_rejected':True,'update_without_approval_rejected':True,'status_readonly':True,'account_no_docker_group':True,'approval_armed':False})
    step='start_transport'; run('systemctl','daemon-reload'); run('systemctl','enable','--now',SERVICE)
    for _ in range(20):
        if listeners()==[gateway+':'+str(PORT)]: break
        time.sleep(.5)
    require(listeners()==[gateway+':'+str(PORT)],'listener_scope'); require(run('systemctl','is-active',SERVICE)=='active','transport_inactive')
    # The worker unit must be inactive; transport root commands cannot create approvals.
    ws=subprocess.run(['systemctl','is-active',WORKER],capture_output=True,text=True,timeout=15)
    require(ws.stdout.strip()=='inactive','worker_unexpectedly_active')
    step='final_scope'; require(p.external_snapshot()==before and p.read_json(j)==rec and root['active_record'](p)[0]==j and not exists(op/'operation.json'),'scope_changed')
    output('RESULTADO',{'installed':True,'scope':'funix-hml','url':'https://'+gateway+':'+str(PORT),'mtls_required':True,'source_restricted':True,'client_certificate_pinned':True,'server_certificate_ip_san':True,'cert_validity_days':180,'client_credentials_export_pending':True,'approval_armed':False,'worker_active':False,'external_preserved':True,'deploy':False})

if __name__=='__main__':
    try: main()
    except Exception as exc:
        # Stop only this newly installed transport if this invocation reached its start.
        if step in ('start_transport','final_scope'):
            try: subprocess.run(['systemctl','disable','--now',SERVICE],capture_output=True,timeout=30)
            except Exception: pass
        why=str(exc) if type(exc) is Blocked else type(exc).__name__
        output('BLOQUEADO',{'step':step,'reason':why if re.fullmatch(r'[A-Za-z0-9_]{1,100}',why) else 'internal_error','deploy':False,'do_not_repeat_if_partial':True}); sys.exit(1)
