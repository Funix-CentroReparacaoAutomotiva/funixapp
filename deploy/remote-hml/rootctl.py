"""HML-only approval, dispatch, and official updater bridge. No remote shell."""
import contextlib
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import time

ROOT=Path('/var/lib/funix-hml-ops')
PREP=Path('/usr/local/lib/funix-hml-prepare/control.py')
PREP_SHA='f44e60e193d0cf2028c96fb0570026bf2345c750e20270f81405a2a01fa10bec'
WORKER='funix-hml-ops-worker.service'
SCHEMA='funix-hml-ops/1'
PHASES={'prepared','quiescing','installing','restoring','accepted_pending_open','restored_pending_open','accepted','restored','rollback_requested'}
class Blocked(Exception): pass

def require(ok, code):
    if not ok: raise Blocked(code)

def hexstr(v,n): return isinstance(v,str) and re.fullmatch('[a-f0-9]{'+str(n)+'}',v) is not None

def op_name(v): return isinstance(v,str) and re.fullmatch(r'op-[A-Za-z0-9_-]{1,80}',v) is not None

def exists(p): return p.exists() or p.is_symlink()

def private_dir(p):
    p=Path(p); s=p.lstat()
    require(p.resolve(strict=True)==p and stat.S_ISDIR(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o700,'private_directory')
    return p

def private_file(p):
    p=Path(p); s=p.lstat()
    require(p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o077,'private_file')
    return p

def read(p):
    p=private_file(p); require(p.stat().st_size<=131072,'json_size'); return json.loads(p.read_text(encoding='utf-8'))

def digest(p):
    with private_file(p).open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()

def canonical(v): return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('ascii')

def hash_obj(v): return hashlib.sha256(canonical(v)).hexdigest()

def fsync_dir(p):
    fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)

def write(p,v):
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f: f.write(canonical(v)+b'\n'); f.flush(); os.fsync(f.fileno())
    fsync_dir(p.parent)

def replace(p,v):
    if exists(p): private_file(p)
    tmp=p.with_name('.'+p.name+'-'+secrets.token_hex(8)); write(tmp,v)
    try: os.replace(tmp,p); fsync_dir(p.parent)
    finally: tmp.unlink(missing_ok=True)

@contextlib.contextmanager
def locked():
    private_dir(ROOT); private_dir(ROOT/'requests')
    fd=os.open(private_file(ROOT/'control.lock'),os.O_RDWR|os.O_NOFOLLOW)
    with os.fdopen(fd,'r+') as f:
        fcntl.flock(f,fcntl.LOCK_EX)
        yield

def prep_module():
    require(digest(PREP)==PREP_SHA,'prepare_controller_changed')
    sys.dont_write_bytecode=True
    spec=importlib.util.spec_from_file_location('funix_hml_prepare_verified',PREP)
    p=importlib.util.module_from_spec(spec); spec.loader.exec_module(p)
    return p

def active_record(p):
    ptr=p.read_json(p.STATE/'active.json')
    require(set(ptr)=={'journal'} and isinstance(ptr['journal'],str),'active_pointer')
    j=Path(ptr['journal']); require(j.name=='operation.json' and j.parent.parent==p.STATE and op_name(j.parent.name),'active_path')
    p.private_dir(j.parent); rec=p.read_json(j)
    require(rec.get('project')=='funix-hml' and rec.get('schema')==1 and rec.get('phase') in PHASES and rec.get('maintenance') is True,'journal_scope')
    for k in ('candidate','previous'):
        require(isinstance(rec.get(k),dict) and hexstr(rec[k].get('revision'),40),'journal_revision')
    return j,rec

def context(check_archive=True):
    p=prep_module(); a=p.read_json(p.PRIVATE/'approval.json'); i=p.check_approval(a)
    token=p.private_file(p.PRIVATE/'github.token').read_text(encoding='ascii').strip()
    require(re.fullmatch(r'github_pat_[A-Za-z0-9_]{20,240}',token) is not None,'token_format')
    op=p.STATE/f"op-{i['run_id']}-{i['attempt']}-prep-{i['artifact_id']}"
    p.private_dir(op); require(not exists(op/'operation.json'),'operation_already_used')
    u=p.load_updater(token); u.host_scope(op,op/'config.json')
    cfg=p.read_json(op/'config.json'); u.check_config(cfg,op)
    require(cfg.get('identity')==i and cfg.get('candidate',{}).get('revision')==i['revision'],'prepared_identity')
    archive=p.private_file(op/'candidate.zip')
    require(archive.stat().st_size==a['size'],'archive_size')
    if check_archive: require(p.sha(archive)==a['digest'],'archive_digest')
    j,rec=active_record(p); phase=rec['phase']
    require(phase in ('accepted','restored'),'project_recovery_pending')
    previous=rec['candidate' if phase=='accepted' else 'previous']
    require(previous['revision']==a['installed_revision'] and previous['revision']!=i['revision'],'installed_revision_changed')
    preview={'action':'update','scope':'funix-hml','identity':i,'operation':op.name,'revision':i['revision'],
             'installed_revision':previous['revision'],'sha256':a['digest'],'size':a['size'],
             'config_sha256':p.sha(op/'config.json'),'active_operation':j.parent.name,'active_journal_sha256':p.sha(j)}
    return p,u,a,token,op,cfg,j,rec,previous,preview

def ticket_valid(t):
    require(isinstance(t,dict) and set(t)=={'schema','ticket_id','issued_at','expires_at','preview','preview_sha256'},'ticket_shape')
    require(t['schema']==SCHEMA and hexstr(t['ticket_id'],32) and type(t['issued_at']) is int and type(t['expires_at']) is int and t['expires_at']-t['issued_at']==1200,'ticket_identity')
    v=t['preview']; require(isinstance(v,dict) and hash_obj(v)==t['preview_sha256'] and v.get('action')=='update' and v.get('scope')=='funix-hml' and op_name(v.get('operation')) and hexstr(v.get('revision'),40) and hexstr(v.get('sha256'),64),'ticket_preview')
    return t

def request_of(t):
    t=ticket_valid(t); v=t['preview']
    return {'action':'update','operation':v['operation'],'revision':v['revision'],'sha256':v['sha256'],'ticket_id':t['ticket_id']}

def request_dir(tid):
    require(hexstr(tid,32),'request_id'); return ROOT/'requests'/tid

def current_request():
    ptr=ROOT/'current.json'
    if not exists(ptr): return None
    d=read(ptr); require(set(d)=={'ticket_id'},'request_pointer'); rd=private_dir(request_dir(d['ticket_id']))
    t=ticket_valid(read(rd/'ticket.json')); require(t['ticket_id']==d['ticket_id'],'request_ticket')
    return rd,t

def require_idle():
    cur=current_request()
    require(cur is None or exists(cur[0]/'result.json'),'request_pending')
    if cur:
        res=read(cur[0]/'result.json'); require(res.get('ticket_id')==cur[1]['ticket_id'] and res.get('status') in ('accepted','auto_restored','blocked_before_journal'),'previous_request_requires_review')

def armed_ticket():
    f=ROOT/'armed.json'
    if not exists(f): return None
    t=ticket_valid(read(f))
    if exists(request_dir(t['ticket_id'])) or t['expires_at']<=int(time.time()): return None
    return t

def base(status): return {'schema':SCHEMA,'scope':'funix-hml','status':status}

def view():
    with locked():
        require_idle(); require(armed_ticket() is None,'approval_already_armed')
        v=context()[-1]
        return {**base('approval_preview'),'preview':v,'preview_sha256':hash_obj(v)}

def approve(expected):
    require(hexstr(expected,64),'approval_digest')
    with locked():
        require_idle(); require(armed_ticket() is None,'approval_already_armed')
        v=context()[-1]; require(hash_obj(v)==expected,'approval_preview_changed')
        now=int(time.time()); t={'schema':SCHEMA,'ticket_id':secrets.token_hex(16),'issued_at':now,'expires_at':now+1200,'preview':v,'preview_sha256':expected}
        replace(ROOT/'armed.json',t)
        return {**base('armed'),'request':request_of(t),'expires_at':t['expires_at'],'installed_revision':v['installed_revision']}

def cancel(tid):
    require(hexstr(tid,32),'ticket_id')
    with locked():
        t=armed_ticket(); require(t is not None and t['ticket_id']==tid,'ticket_not_armed')
        (ROOT/'armed.json').unlink(); fsync_dir(ROOT)
        return {**base('cancelled'),'ticket_id':tid}

def parse_request(data):
    require(0<len(data)<=4096,'request_size')
    def pairs(items):
        d={}
        for k,v in items:
            require(k not in d,'duplicate_field'); d[k]=v
        return d
    try: v=json.loads(data,object_pairs_hook=pairs)
    except (UnicodeError,ValueError): raise Blocked('request_json') from None
    require(isinstance(v,dict) and set(v)=={'action','operation','revision','sha256','ticket_id'},'request_shape')
    require(v['action']=='update' and op_name(v['operation']) and hexstr(v['revision'],40) and hexstr(v['sha256'],64) and hexstr(v['ticket_id'],32),'request_identity')
    return v

def dispatch(data):
    v=parse_request(data)
    with locked():
        require_idle(); t=armed_ticket(); require(t is not None,'approval_required')
        require(v==request_of(t),'approval_mismatch')
        unit=subprocess.run(['/usr/bin/systemctl','show','--property=ActiveState','--value',WORKER],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=15)
        require(unit.returncode==0 and unit.stdout.strip() in ('inactive','failed'),'worker_busy')
        # Consume exactly once. A crash before systemctl start is visible; never retry automatically.
        rd=request_dir(t['ticket_id']); rd.mkdir(mode=0o700); fsync_dir(rd.parent)
        write(rd/'ticket.json',t); replace(ROOT/'current.json',{'ticket_id':t['ticket_id']})
        (ROOT/'armed.json').unlink(); fsync_dir(ROOT)
        r=subprocess.run(['/usr/bin/systemctl','start','--no-block',WORKER],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
        require(r.returncode==0,'worker_start_uncertain')
        return {**base('queued'),'request':v,'deploy_completed':False}

def status():
    with locked():
        p=prep_module(); j,rec=active_record(p); phase=rec['phase']
        t=armed_ticket(); cur=current_request(); last=None
        if cur:
            rd,ct=cur
            if exists(rd/'result.json'):
                last=read(rd/'result.json'); require(last.get('ticket_id')==ct['ticket_id'],'result_identity')
            else: last={'ticket_id':ct['ticket_id'],'operation':ct['preview']['operation'],'revision':ct['preview']['revision'],'status':'running_or_interrupted' if exists(rd/'started.json') else 'queued_or_interrupted'}
        return {**base('ok'),'armed':None if t is None else {'request':request_of(t),'expires_at':t['expires_at'],'installed_revision':t['preview']['installed_revision']},'last_request':last,'journal':{'operation':j.parent.name,'phase':phase,'candidate_revision':rec['candidate']['revision'],'previous_revision':rec['previous']['revision']}}

def reason(e):
    x=str(e) if type(e) is Blocked else type(e).__name__
    return x if re.fullmatch(r'[A-Za-z0-9_]{1,80}',x) else 'internal_error'

def worker():
    with locked():
        cur=current_request(); require(cur is not None,'no_request'); rd,t=cur
        require(not exists(rd/'started.json') and not exists(rd/'result.json'),'request_already_started')
        write(rd/'started.json',{'started_at':int(time.time())})
    v=t['preview']; op=None; p=None; u=None; cfg=None; before=None; invocation=False
    result={**base('blocked_before_journal'),'ticket_id':t['ticket_id'],'operation':v['operation'],'revision':v['revision'],'journal_phase':None,'installed_revision':None,'backup_verified':False,'https_verified':False,'external_preserved':False,'reason':None}
    try:
        require(t['issued_at']<=int(time.time())<t['expires_at'],'approval_expired')
        p,u,a,token,op,cfg,old_j,old_rec,previous,current=context()
        require(current==v and hash_obj(current)==t['preview_sha256'],'approved_state_changed')
        before=p.external_snapshot(); p.metadata(a,token)
        # Recheck the exact approved predecessor under the official updater's own lock,
        # before candidate images are loaded. Do not hold this lock outside the updater.
        original=u.checked_update_package
        def checked(config,adapter):
            require(int(time.time())<t['expires_at'],'approval_expired')
            j,rec=active_record(p); require(j==old_j and p.sha(j)==v['active_journal_sha256'] and rec==old_rec,'active_journal_changed')
            require(not exists(op/'operation.json') and p.sha(op/'config.json')==v['config_sha256'] and p.sha(op/'candidate.zip')==v['sha256'],'approved_files_changed')
            require(u.installed_preflight(adapter)==previous,'installed_release_changed')
            require(p.external_snapshot()==before,'external_scope_changed')
            original(config,adapter)
        u.checked_update_package=checked
        invocation=True
        # Preserve the official transaction, maintenance gate and automatic restoration.
        coordinator=u.load('hml-official-update')
        with coordinator.sanitized_output():
            coordinator.execute_prepared(op,cfg,cfg['identity'],authorize_operation=op.name,
                                         authorize_revision=v['revision'],official_updater=u)
        rec=p.read_json(op/'operation.json'); result['journal_phase']=rec.get('phase')
        require(rec.get('phase')=='accepted' and rec.get('candidate',{}).get('revision')==v['revision'],'not_accepted')
        require(active_record(p)[0]==op/'operation.json','active_operation_changed')
        require(hexstr(rec.get('backup_sha256'),64) and p.sha(op/'backup.sqlite')==rec['backup_sha256'],'backup_digest')
        result['backup_verified']=True
        final=u.installed_preflight(u.make_adapter(cfg)); require(final==rec['candidate'],'final_release')
        result['https_verified']=True; result['installed_revision']=final['revision']
        result['external_preserved']=p.external_snapshot()==before; require(result['external_preserved'],'external_scope_changed')
        result['status']='accepted'
    except Exception as e:
        result['reason']=reason(e)
        if invocation and p is not None and op is not None:
            try:
                if exists(op/'operation.json'):
                    rec=p.read_json(op/'operation.json'); phase=rec.get('phase'); result['journal_phase']=phase if phase in PHASES else None
                    result['status']='accepted_requires_review' if phase=='accepted' else 'requires_recovery'
                    if phase=='restored' and active_record(p)[0]==op/'operation.json':
                        final=u.installed_preflight(u.make_adapter(cfg)); result['installed_revision']=final['revision']; result['https_verified']=final==rec['previous']
                        if 'backup_sha256' in rec: result['backup_verified']=p.sha(op/'backup.sqlite')==rec['backup_sha256']
                        result['external_preserved']=p.external_snapshot()==before
                        if result['https_verified'] and result['external_preserved'] and ('backup_sha256' not in rec or result['backup_verified']): result['status']='auto_restored'
                else:
                    j,rec=active_record(p)
                    if j!=old_j or rec!=old_rec: result['status']='requires_review'
            except Exception: result['status']='requires_review'
    finally:
        result['finished_at']=int(time.time())
        with locked(): write(rd/'result.json',result)
    return result

def main():
    os.umask(0o077); require(os.geteuid()==0,'root_only')
    args=sys.argv[1:]
    if args==['status']: return status()
    if args==['preview']: return view()
    if len(args)==2 and args[0]=='approve': return approve(args[1])
    if len(args)==2 and args[0]=='cancel': return cancel(args[1])
    if args==['dispatch']: return dispatch(sys.stdin.buffer.read(4097))
    if args==['worker']: return worker()
    raise Blocked('command_not_allowed')

if __name__=='__main__':
    try: r=main(); print(json.dumps(r,sort_keys=True),flush=True); sys.exit(0 if r['status'] not in ('requires_review','requires_recovery','accepted_requires_review','blocked_before_journal','auto_restored') else 1)
    except Exception as e: print(json.dumps({**base('blocked'),'reason':reason(e)},sort_keys=True),flush=True); sys.exit(1)
