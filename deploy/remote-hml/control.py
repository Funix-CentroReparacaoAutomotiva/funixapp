"""Restricted, preparation-only HML gateway. Installed by the VPS administrator."""
import contextlib
import datetime
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import syslog
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = Path('/usr/local/lib/funix-hml-prepare')
PRIVATE = Path('/var/lib/funix-hml-prepare-control')
STATE = Path('/var/lib/funix-hml/updater')
REPO = 'Funix-CentroReparacaoAutomotiva/funixapp'
WORKFLOW = '.github/workflows/funix-hml-candidate.yml'
FILES = {
    'hml-update':'1b5644664197aed80876a5985784049fae16cd13',
    'hml-update-safety':'ee35bfce1c8c323d5f69cccbb7b493a24cf9ac18',
    'hml-update-transaction':'2d9c7008775f775f3019feb825e38ee4b9b433f9',
    'hml-docker-adapter':'f6cced157db9fc77ac1ef261e968c34371822d41',
    'hml-docker-maintenance':'ec25ab3c3e59cb1bbfbe2627978fa2a01ba830ff',
    'hml-artifact-provenance':'fdf995c8500117f398aca6c34c96a31a170e8760',
    'hml-image-identity':'e3edb166a89c3da458beb60e5f8e778b5c0beb6f',
    'hml-writer-guard':'9c6dccb01e83b2cc6ec9b5d03e3e27486d843334',
    'hml-maintenance':'455e2735efb3596340f21e04ca1036d14981808c',
    'hml-isolation':'d99c222f678e818a08c485f6e85bd20ea93c48d4',
    'hml-official-update':'447f3d190094057122729f046ef074884ffb5a4b',
}
class Blocked(Exception): pass

def must(ok, why):
    if not ok: raise Blocked(why)

def private_dir(path):
    path=Path(path); s=path.lstat()
    must(path.resolve(strict=True)==path and stat.S_ISDIR(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o700,'private_directory')
    return path

def private_file(path):
    path=Path(path); s=path.lstat()
    must(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not(s.st_mode&0o077),'private_file')
    return path

def read_json(path,limit=65536):
    p=private_file(path); must(p.stat().st_size<=limit,'json_size')
    return json.loads(p.read_text(encoding='utf-8'))

def sha(path):
    with private_file(path).open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()

def save(path,data):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
    fd=os.open(Path(path).parent,os.O_RDONLY|os.O_DIRECTORY); os.fsync(fd); os.close(fd)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

# No bearer token on redirected blob request; no environment proxies or redirects.
OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())

def new_request(path,token):
    must(re.fullmatch(r'(?:actions/runs/[1-9][0-9]*/attempts/[1-9][0-9]*|actions/artifacts/[1-9][0-9]*(?:/zip)?|pulls/[1-9][0-9]*)',path) is not None,'api_path')
    return urllib.request.Request('https://api.github.com/repos/'+REPO+'/'+path,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','User-Agent':'FUNIX-HML-prepare','X-GitHub-Api-Version':'2022-11-28'})

def query(path,token):
    with OPENER.open(new_request(path,token),timeout=30) as r:
        must(r.status==200,'github_status'); data=r.read(4*1024*1024+1)
    must(len(data)<=4*1024*1024,'github_json_size'); return json.loads(data)

def check_approval(a):
    must(set(a)=={'identity','digest','size','installed_revision'},'approval_shape')
    i=a['identity']; must(set(i)=={'pr','run_id','attempt','artifact_id','revision'},'identity_shape')
    for k in ('pr','run_id','attempt','artifact_id'): must(type(i[k]) is int and 0<i[k]<10**15,'identity_number')
    for key,val in [('revision',i['revision']),('installed_revision',a['installed_revision'])]: must(isinstance(val,str) and re.fullmatch(r'[a-f0-9]{40}',val) is not None,key)
    must(isinstance(a['digest'],str) and re.fullmatch(r'[a-f0-9]{64}',a['digest']) is not None,'digest')
    must(type(a['size']) is int and 0<a['size']<=1024**3,'size_limit'); return i

def metadata(a,token):
    i=check_approval(a)
    run=query(f"actions/runs/{i['run_id']}/attempts/{i['attempt']}",token)
    expected={'id':i['run_id'],'run_attempt':i['attempt'],'event':'workflow_dispatch','head_branch':'main','path':WORKFLOW,'status':'completed','conclusion':'success'}
    must(all(run.get(k)==v for k,v in expected.items()) and run.get('repository',{}).get('full_name')==REPO,'workflow_identity')
    art=query(f"actions/artifacts/{i['artifact_id']}",token)
    must(art.get('id')==i['artifact_id'] and art.get('expired') is False and art.get('name')==f"funix-hml-{i['revision']}-{i['attempt']}" and art.get('workflow_run',{}).get('id')==i['run_id'] and art.get('size_in_bytes')==a['size'] and art.get('digest')=='sha256:'+a['digest'],'artifact_identity')
    pr=query(f"pulls/{i['pr']}",token)
    must(pr.get('head',{}).get('sha')==i['revision'] and pr.get('head',{}).get('repo',{}).get('full_name')==REPO and pr.get('base',{}).get('ref')=='main','pr_identity')
    return art

def allowed_blob(url):
    p=urllib.parse.urlsplit(url); host=p.hostname or ''
    return p.scheme=='https' and not p.username and not p.password and p.port in (None,443) and not p.fragment and (host.endswith('.blob.core.windows.net') or host.endswith('.actions.githubusercontent.com'))

def download(a,token,op):
    i=a['identity']; dest=op/'candidate.zip'
    if dest.exists() or dest.is_symlink():
        must(private_file(dest).stat().st_size==a['size'] and sha(dest)==a['digest'],'existing_archive_mismatch'); return
    req=new_request(f"actions/artifacts/{i['artifact_id']}/zip",token)
    try:
        with OPENER.open(req,timeout=30): raise Blocked('download_expected_redirect')
    except urllib.error.HTTPError as e:
        try:
            must(e.code==302,'download_redirect_status'); url=e.headers.get('Location','')
        finally: e.close()
    must(allowed_blob(url),'download_host')
    fd,tmp=tempfile.mkstemp(prefix='candidate-download-',dir=op); tmp=Path(tmp)
    try:
        count=0; h=hashlib.sha256(); deadline=time.monotonic()+300
        with os.fdopen(fd,'wb') as f, OPENER.open(urllib.request.Request(url,headers={'User-Agent':'FUNIX-HML-prepare'}),timeout=30) as r:
            must(r.status==200,'blob_status')
            while True:
                must(time.monotonic()<deadline,'download_deadline')
                data=r.read(1024*1024)
                if not data: break
                count+=len(data); must(count<=a['size'],'download_size'); h.update(data); f.write(data)
            must(count==a['size'] and h.hexdigest()==a['digest'],'download_digest'); f.flush(); os.fsync(f.fileno())
        must(not dest.exists() and not dest.is_symlink(),'archive_already_exists'); os.replace(tmp,dest)
        d=os.open(op,os.O_RDONLY|os.O_DIRECTORY); os.fsync(d); os.close(d)
    finally: tmp.unlink(missing_ok=True)

def load_updater(token):
    private_dir(BASE); code=private_dir(BASE/'official')
    for name,digest in FILES.items():
        b=private_file(code/(name+'.py')).read_bytes()
        must(hashlib.sha1(('blob '+str(len(b))+'\0').encode()+b).hexdigest()==digest,'updater_integrity')
    sys.dont_write_bytecode=True
    spec=importlib.util.spec_from_file_location('funix_hml_official',code/'hml-update.py'); u=importlib.util.module_from_spec(spec); spec.loader.exec_module(u)
    original_load=u.load; provenance=original_load('hml-artifact-provenance'); original_verify=provenance.verify
    def verify(archive,**identity): return original_verify(archive,query=lambda path:query(path,token),**identity)
    provenance.verify=verify
    u.load=lambda name: provenance if name=='hml-artifact-provenance' else original_load(name)
    return u

def run(*args): return subprocess.check_output(args,stderr=subprocess.DEVNULL,text=True,timeout=45).strip()

def external_snapshot():
    ids=run('/usr/bin/docker','ps','-q').split(); must(bool(ids),'container_list')
    records=json.loads(run('/usr/bin/docker','inspect',*ids)); ext={}; db=Path('/var/lib/funix-hml/app-data')
    for row in records:
        if row['Config'].get('Labels',{}).get('com.docker.compose.project')=='funix-hml': continue
        for m in row.get('Mounts',[]):
            if not m.get('Source'): continue
            p=Path(m['Source']).resolve(); must(not(p==db or p in db.parents or db in p.parents),'external_database_overlap')
        ext[row['Id']]=(row['State']['StartedAt'],row['RestartCount'])
    must(len(ext)>=9,'external_services'); return ext

def installed_from_journal(rec):
    must(rec.get('schema')==1 and rec.get('project')=='funix-hml' and
         rec.get('phase') in ('accepted','restored'),'current_transaction')
    release=rec.get('candidate' if rec['phase']=='accepted' else 'previous')
    must(isinstance(release,dict) and re.fullmatch(r'[a-f0-9]{40}',release.get('revision','')) is not None,
         'current_transaction')
    return release

def prepare():
    must(os.geteuid()==0 and len(sys.argv)==1,'local_scope'); private_dir(PRIVATE); private_dir(STATE)
    a=read_json(PRIVATE/'approval.json'); i=check_approval(a)
    token=private_file(PRIVATE/'github.token').read_text(encoding='ascii').strip()
    must(re.fullmatch(r'github_pat_[A-Za-z0-9_]{20,240}',token) is not None,'token_format')
    op=STATE/f"op-{i['run_id']}-{i['attempt']}-prep-{i['artifact_id']}"
    fd=os.open(private_file(STATE/'lock'),os.O_RDWR|os.O_NOFOLLOW)
    with os.fdopen(fd,'r+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        pointer=read_json(STATE/'active.json'); journal=Path(pointer['journal']); active=journal.parent
        must(journal.name=='operation.json' and active.parent==STATE and re.fullmatch(r'op-[A-Za-z0-9_-]{1,80}',active.name) is not None,'active_pointer'); private_dir(active)
        rec=read_json(journal); installed=installed_from_journal(rec)
        must(installed['revision']==a['installed_revision'],'current_transaction')
        u=load_updater(token); u.host_scope(active,active/'config.json')
        cfg=read_json(active/'config.json'); u.check_config(cfg,active)
        current=u.installed_preflight(u.make_adapter(cfg)); must(current==installed,'installed_release')
        before=external_snapshot(); metadata(a,token)
        db=Path(u.DATABASE); must(shutil.disk_usage(STATE).free>a['size']*4+db.stat().st_size*4+512*1024**2,'space')
        if not op.exists(): op.mkdir(mode=0o700)
        private_dir(op); must(not (op/'operation.json').exists() and not (op/'operation.json').is_symlink(),'operation_already_used')
        u.host_scope(op,op/'config.json'); download(a,token,op)
        # Preparation is idempotent for this approved candidate only. Never start an update here.
        if (op/'config.json').exists():
            candidate_cfg=read_json(op/'config.json'); u.check_config(candidate_cfg,op)
            must(candidate_cfg.get('identity')==i,'prepared_identity'); adapter=u.make_adapter(candidate_cfg)
            u.prepare_candidate(candidate_cfg,adapter,u.load('hml-update-safety'),load_images=False)
        else:
            with contextlib.redirect_stdout(io.StringIO()): u.prepare_operation(op,op/'config.json',i)
            candidate_cfg=read_json(op/'config.json'); u.check_config(candidate_cfg,op)
        must(candidate_cfg.get('identity')==i and sha(op/'candidate.zip')==a['digest'],'prepared_artifact')
        must(u.installed_preflight(u.make_adapter(cfg))==current and external_snapshot()==before and read_json(STATE/'active.json')==pointer and read_json(journal)==rec,'final_scope')
        return {'schema':'funix-hml-prepare/1','status':'prepared','scope':'funix-hml','pr':i['pr'],'run_id':i['run_id'],'attempt':i['attempt'],'artifact_id':i['artifact_id'],'revision':i['revision'],'sha256':a['digest'],'operation':op.name,'installed_revision':current['revision'],'preflight':True,'provenance':True,'docker_load':False,'deploy':False,'backup_executed':False,'external_preserved':True}

def main():
    os.umask(0o077); syslog.openlog('funix-hml-prepare')
    try:
        out=prepare(); syslog.syslog(syslog.LOG_INFO,'prepared '+out['operation']+' '+out['revision']); print(json.dumps(out,sort_keys=True),flush=True); return 0
    except Exception as exc:
        reason=str(exc) if type(exc) is Blocked else type(exc).__name__
        # The only emitted details are fixed reason codes or exception types; never exception text from network/updater.
        syslog.syslog(syslog.LOG_WARNING,'blocked '+reason); print(json.dumps({'schema':'funix-hml-prepare/1','scope':'funix-hml','status':'blocked','reason':reason,'deploy':False}),flush=True); return 1

if __name__=='__main__': sys.exit(main())
