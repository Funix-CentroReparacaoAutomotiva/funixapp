"""Administrative code-only pilot migration. Never install accounts, units or credentials."""
import argparse
import ast
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile

PACKAGE = Path(__file__).resolve().parent
STATE = Path('/var/lib/funix-hml-ops')
UPDATER = Path('/var/lib/funix-hml/updater')
TRANSPORT = 'funix-hml-ops-transport.service'
WORKER = 'funix-hml-ops-worker.service'


def pins():
    tree = ast.parse((PACKAGE/'control.py').read_text())
    return next(ast.literal_eval(node.value) for node in tree.body
                if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id=='FILES' for t in node.targets))


def targets():
    result = {Path('/usr/local/lib/funix-hml-ops')/name: PACKAGE/name
              for name in ('rootctl.py','transport.py')}
    result[Path('/usr/local/lib/funix-hml-prepare/control.py')] = PACKAGE/'control.py'
    for name in pins():
        result[Path('/usr/local/lib/funix-hml-prepare/official')/(name+'.py')] = PACKAGE.parent/(name+'.py')
    return result


def regular(path):
    info = path.lstat()
    if (path.resolve(strict=True)!=path or not stat.S_ISREG(info.st_mode)
            or info.st_uid!=os.geteuid() or info.st_nlink!=1 or info.st_mode & 0o022):
        raise ValueError('unsafe code/state file')
    return path


def private_directory(path):
    info=path.lstat()
    if path.resolve(strict=True)!=path or not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.geteuid() or stat.S_IMODE(info.st_mode)!=0o700:
        raise ValueError('private directory required')


def digest(path):
    with regular(path).open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()


def durable_json(path, record):
    temporary = path.with_name(path.name+'.new')
    fd = os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as stream:
        json.dump(record,stream,sort_keys=True); stream.flush(); os.fsync(stream.fileno())
    os.replace(temporary,path)
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def inventory(mapping):
    return {str(target):digest(target) if target.exists() or target.is_symlink() else None for target in mapping}


def backup_path(directory,target):
    return directory/hashlib.sha256(str(target).encode()).hexdigest()


def command(*arguments):
    result=subprocess.run(arguments,capture_output=True,text=True,timeout=30)
    if result.returncode:
        raise ValueError('administrative command failed')
    return result.stdout.strip()


@contextlib.contextmanager
def locks():
    with contextlib.ExitStack() as stack:
        for path in (STATE/'control.lock',UPDATER/'lock'):
            fd=os.open(regular(path),os.O_RDWR|os.O_NOFOLLOW)
            stream=stack.enter_context(os.fdopen(fd,'r+'))
            fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield


def idle():
    if (STATE/'armed.json').exists() or (STATE/'armed.json').is_symlink():
        raise ValueError('cancel administrative approval before migration')
    current=STATE/'current.json'
    if current.exists():
        ticket=json.loads(regular(current).read_text())['ticket_id']
        import re
        if not isinstance(ticket,str) or not re.fullmatch('[a-f0-9]{32}',ticket):
            raise ValueError('request pointer')
        result=json.loads(regular(STATE/'requests'/ticket/'result.json').read_text())
        if result.get('status') not in ('accepted','auto_restored','blocked_before_journal'):
            raise ValueError('request requires inspection')
    if command('systemctl','show','--property=ActiveState','--value',WORKER)!='inactive':
        raise ValueError('worker must be inactive')
    pointer=json.loads(regular(UPDATER/'active.json').read_text())
    journal=Path(pointer['journal'])
    import re
    if journal.name!='operation.json' or journal.parent.parent!=UPDATER or not re.fullmatch(r'op-[A-Za-z0-9_-]{1,80}',journal.parent.name):
        raise ValueError('journal path')
    record=json.loads(regular(journal).read_text())
    if record.get('schema')!=1 or record.get('project')!='funix-hml' or record.get('phase') not in ('accepted','restored'):
        raise ValueError('HML recovery pending')


def source_integrity(mapping):
    """Verify exact pinned bytes before any code replacement or journal creation."""
    from ast import literal_eval
    rootctl = PACKAGE/'rootctl.py'
    control = PACKAGE/'control.py'
    root_tree = ast.parse(regular(rootctl).read_text(encoding='utf-8'))
    pinned = next(literal_eval(n.value) for n in root_tree.body
                  if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='PREP_SHA' for t in n.targets))
    if pinned != digest(control):
        raise ValueError('candidate prepare controller pin mismatch')
    official = pins()
    if not isinstance(official,dict) or len(official)<1:
        raise ValueError('candidate pins missing')
    for name, expected in official.items():
        if not isinstance(name,str) or not isinstance(expected,str) or len(expected)!=40:
            raise ValueError('candidate pin invalid')
        path = PACKAGE.parent/(name+'.py')
        data = regular(path).read_bytes()
        actual = hashlib.sha1(b'blob '+str(len(data)).encode('ascii')+bytes([0])+data).hexdigest()
        if actual != expected:
            raise ValueError('candidate official module pin mismatch')
    if set(mapping)!=set(targets()) or any(mapping[t]!=targets()[t] for t in mapping):
        raise ValueError('candidate scope mismatch')


def prior_restoration(mapping, *, require_installed_old=True):
    """A closed migration is immutable. Retry only from a fully restored baseline."""
    directory=STATE/'migration'
    private_directory(directory)
    record=json.loads(regular(directory/'journal.json').read_text(encoding='utf-8'))
    expected={str(t) for t in mapping}
    if record.get('schema')!=1 or record.get('phase')!='restored' or set(record.get('old',{}))!=expected or set(record.get('new',{}))!=expected:
        raise ValueError('prior migration not safely restored')
    if require_installed_old and inventory(mapping)!=record['old']:
        raise ValueError('installed code differs from prior restoration')
    for target in mapping:
        old=record['old'][str(target)]
        if old is None: continue
        saved=backup_path(directory,target)
        if digest(saved)!=old:
            raise ValueError('prior backup differs')
    return record


def replace_code(source,target,mode):
    fd,name=tempfile.mkstemp(prefix='.'+target.name+'.migration-',dir=target.parent)
    temporary=Path(name)
    try:
        os.fchmod(fd,mode)
        with os.fdopen(fd,'wb') as out, regular(source).open('rb') as inp:
            shutil.copyfileobj(inp,out); out.flush(); os.fsync(out.fileno())
        os.replace(temporary,target)
    finally:
        temporary.unlink(missing_ok=True)
    fd=os.open(target.parent,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def migrate(mapping, directory, approval, *, recover=False, validate=lambda: None):
    """Caller holds existing official locks. Injectable only for synthetic tests."""
    journal=directory/'journal.json'
    if recover:
        private_directory(directory)
        record=json.loads(regular(journal).read_text())
    else:
        if directory.exists(): raise ValueError('existing migration requires inspection/recovery')
        old=inventory(mapping)
        new={str(t):digest(s) for t,s in mapping.items()}
        if approval!={'old':old,'new':new}: raise ValueError('migration approval mismatch')
        directory.mkdir(mode=0o700)
        record={'schema':1,'phase':'prepared','old':old,'new':new,
                'modes':{str(t):stat.S_IMODE(t.stat().st_mode) if old[str(t)] is not None else 0o600 for t in mapping},
                'transport_active':command('systemctl','show','--property=ActiveState','--value',TRANSPORT)=='active'}
        for target in mapping:
            if old[str(target)] is None: continue
            saved=backup_path(directory,target)
            shutil.copyfile(target,saved); os.chmod(saved,0o600)
            with saved.open('rb') as f: os.fsync(f.fileno())
            if digest(saved)!=old[str(target)]: raise ValueError('original code changed')
        for target,source in mapping.items():
            staged=directory/('new-'+backup_path(directory,target).name)
            shutil.copyfile(regular(source),staged); os.chmod(staged,0o600)
            with staged.open('rb') as f: os.fsync(f.fileno())
            if digest(staged)!=new[str(target)]: raise ValueError('staged code differs')
        durable_json(journal,record)
    if record.get('schema')!=1 or set(record['old'])!={str(t) for t in mapping}:
        raise ValueError('migration journal scope')
    if record['phase'] in ('accepted','restored'): return record['phase']
    record['phase']='installing' if not recover else 'restoring'; durable_json(journal,record)
    command('systemctl','stop',TRANSPORT)
    try:
        if recover: raise ValueError('explicit recovery')
        for target in mapping:
            source=directory/('new-'+backup_path(directory,target).name)
            if digest(source)!=record['new'][str(target)]: raise ValueError('staged source changed')
            replace_code(source,target,record['modes'][str(target)])
        if inventory(mapping)!=record['new']: raise ValueError('installed code differs')
        validate()
    except Exception:
        record['phase']='restoring'; durable_json(journal,record)
        for target in mapping:
            if record['old'][str(target)] is None:
                if target.exists() or target.is_symlink():
                    if digest(target)!=record['new'][str(target)]: raise ValueError('new target changed')
                    target.unlink()
                    fd=os.open(target.parent,os.O_RDONLY|os.O_DIRECTORY)
                    try: os.fsync(fd)
                    finally: os.close(fd)
                continue
            source=backup_path(directory,target)
            if digest(source)!=record['old'][str(target)]: raise ValueError('backup changed')
            replace_code(source,target,record['modes'][str(target)])
        if inventory(mapping)!=record['old']: raise ValueError('restoration differs')
        validate()
        record['phase']='restored'
    else:
        record['phase']='accepted'
    # Keep transport stopped on any interruption until this point.
    if record['transport_active']: command('systemctl','start',TRANSPORT)
    durable_json(journal,record)
    return record['phase']


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('inventory','apply','recover','retry-restored','recover-retry'))
    parser.add_argument('--authorize',action='store_true')
    args=parser.parse_args()
    if os.geteuid()!=0: raise ValueError('local administrator required')
    mapping=targets()
    private_directory(STATE); private_directory(UPDATER)
    with locks():
        idle()
        if args.action=='inventory':
            print(json.dumps({'old':inventory(mapping),'new':{str(t):digest(s) for t,s in mapping.items()}},sort_keys=True)); return
        if not args.authorize: raise ValueError('administrative authorization required')
        retry=args.action in ('retry-restored','recover-retry')
        if retry: prior_restoration(mapping,require_installed_old=args.action!='recover-retry')
        if args.action in ('apply','retry-restored'):
            source_integrity(mapping)
        approval_file=STATE/('migration-approval-retry.json' if retry else 'migration-approval.json')
        approval=json.loads(regular(approval_file).read_text()) if args.action in ('apply','retry-restored') else None
        def validate():
            command('/usr/bin/python3','-I','-B','-c',"import importlib.util; s=importlib.util.spec_from_file_location('r','/usr/local/lib/funix-hml-ops/rootctl.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.prep_module().load_updater('')")
        destination=STATE/('migration-retry' if retry else 'migration')
        result=migrate(mapping,destination,approval,recover=args.action in ('recover','recover-retry'),validate=validate)
        print(json.dumps({'scope':'funix-hml','migration':result,'attempt':'retry' if retry else 'original'}))


if __name__=='__main__':
    try: main()
    except Exception: raise SystemExit('BLOCKED: inspect private migration journal')
