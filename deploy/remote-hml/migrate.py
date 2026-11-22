"""Administrative code-only pilot migration. Never install accounts, units or credentials."""
import argparse
import ast
import contextlib
import fcntl
import hashlib
import json
import os
import re
import secrets
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
TRIAL = 'funix-hml-ops-migration-check.service'
GATE = Path('/etc/systemd/system') / (TRANSPORT + '.d') / '90-funix-migration.conf'
TERMINAL = ('accepted', 'restored')
SELECTION = Path('/usr/local/lib/funix-hml-prepare/official/hml-selection.py')
RETRY_ACTIONS = {'retry-restored':'apply', 'probe-retry':'probe', 'accept-retry':'accept',
                 'recover-retry':'recover', 'rollback-retry':'rollback'}

UPGRADE_ACTIONS = {name+'-upgrade':name for name in ('apply','probe','accept','recover','rollback')}


def pins():
    tree = ast.parse(regular(PACKAGE/'control.py').read_bytes())
    return next(ast.literal_eval(node.value) for node in tree.body
                if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id=='FILES' for t in node.targets))


def targets():
    result = {Path('/usr/local/lib/funix-hml-ops')/name: PACKAGE/name
              for name in ('rootctl.py','transport.py')}
    result[Path('/usr/local/lib/funix-hml-prepare/control.py')] = PACKAGE/'control.py'
    official = pins()
    if not isinstance(official, dict) or len(official) != 12 or not all(
            isinstance(name,str) and re.fullmatch(r'hml-[a-z-]+',name) for name in official
    ) or 'hml-selection' not in official:
        raise ValueError('candidate pins missing or invalid')
    for name in official:
        result[Path('/usr/local/lib/funix-hml-prepare/official')/(name+'.py')] = PACKAGE.parent/(name+'.py')
    return result


def source_integrity(mapping):
    """Validate candidate bytes and return the exact hashes to stage."""
    sources = {target: regular(path).read_bytes() for target, path in mapping.items()}
    if any(b'\r\n' in data for data in sources.values()):
        raise ValueError('candidate contains CRLF')

    def assignment(data, name):
        return next(ast.literal_eval(node.value) for node in ast.parse(data).body
                    if isinstance(node, ast.Assign) and any(
                        isinstance(target, ast.Name) and target.id == name for target in node.targets))

    control = sources[Path('/usr/local/lib/funix-hml-prepare/control.py')]
    rootctl = sources[Path('/usr/local/lib/funix-hml-ops/rootctl.py')]
    if hashlib.sha256(control).hexdigest() != assignment(rootctl, 'PREP_SHA'):
        raise ValueError('candidate prepare controller pin mismatch')
    official = assignment(control, 'FILES')
    if set(sources) != targets().keys():
        raise ValueError('candidate target scope mismatch')
    if set(official) != {target.stem for target in sources if target.parent == SELECTION.parent}:
        raise ValueError('candidate pins missing or invalid')
    for name, expected in official.items():
        data = sources[SELECTION.parent/(name+'.py')]
        if hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() != expected:
            raise ValueError('candidate official module pin mismatch')
    return {str(target):hashlib.sha256(data).hexdigest() for target,data in sources.items()}


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


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable_bytes(path, data, mode=0o600):
    fd, name = tempfile.mkstemp(prefix=path.name+'.', suffix='.new', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def durable_json(path, record):
    durable_bytes(path, json.dumps(record, sort_keys=True).encode())


def inventory(mapping):
    return {str(target):digest(target) if target.exists() or target.is_symlink() else None for target in mapping}


def backup_path(directory,target):
    return directory/hashlib.sha256(str(target).encode()).hexdigest()


def exists(path):
    return path.exists() or path.is_symlink()


def prior_restoration(mapping, directory, *, require_installed_old=False):
    """Read the immutable schema-1 transaction from #308, with its 14 destinations."""
    private_directory(directory)
    data = regular(directory/'journal.json').read_bytes()
    record = json.loads(data)
    paths = {str(target) for target in mapping if target != SELECTION}
    if (record.get('schema') != 1 or record.get('phase') != 'restored'
            or record.get('transport_active') is not True or SELECTION not in mapping
            or any(set(record[key]) != paths for key in ('old','new','modes'))
            or exists(directory/'hold')):
        raise ValueError('prior migration not safely restored')
    for target in mapping:
        if target == SELECTION:
            continue
        key = str(target)
        saved = backup_path(directory,target)
        old = record['old'][key]
        if old is None:
            if exists(saved):
                raise ValueError('unexpected prior backup')
        elif digest(saved) != old:
            raise ValueError('prior backup differs')
        if digest(saved.with_name('new-'+saved.name)) != record['new'][key]:
            raise ValueError('prior staged digest differs')
    if require_installed_old:
        baseline = {'old':{**record['old'],str(SELECTION):None}, 'modes':record['modes']}
        check_files(mapping,baseline,('old',))
    return hashlib.sha256(data).hexdigest()


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
    last = None
    if current.exists() or current.is_symlink():
        ticket=json.loads(regular(current).read_text())['ticket_id']
        if not isinstance(ticket,str) or not re.fullmatch('[a-f0-9]{32}',ticket):
            raise ValueError('request pointer')
        result=json.loads(regular(STATE/'requests'/ticket/'result.json').read_text())
        if result.get('ticket_id') != ticket or result.get('status') not in ('accepted','auto_restored','blocked_before_journal'):
            raise ValueError('request requires inspection')
        last = {key: result.get(key) for key in
                ('status','operation','revision','journal_phase','installed_revision',
                 'backup_verified','https_verified','external_preserved')}
    if command('systemctl','show','--property=ActiveState','--value',WORKER)!='inactive':
        raise ValueError('worker must be inactive')
    pointer=json.loads(regular(UPDATER/'active.json').read_text())
    journal=Path(pointer['journal'])
    if journal.name!='operation.json' or journal.parent.parent!=UPDATER or not re.fullmatch(r'op-[A-Za-z0-9_-]{1,80}',journal.parent.name):
        raise ValueError('journal path')
    record=json.loads(regular(journal).read_text())
    if record.get('schema')!=1 or record.get('project')!='funix-hml' or record.get('maintenance') is not True or record.get('phase') not in ('accepted','restored'):
        raise ValueError('HML recovery pending')
    return {'journal':{
        'operation': journal.parent.name, 'phase': record['phase'],
        'candidate_revision': record['candidate']['revision'],
        'previous_revision': record['previous']['revision'],
    }, 'last_request': last}


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


def gate_content(directory):
    return f'[Unit]\nConditionPathExists=!{directory}/hold\n'.encode()


def set_gate(directory):
    """Commit a boot-persistent condition before stopping or changing code."""
    hold = directory/'hold'
    if hold.exists() or hold.is_symlink():
        if regular(hold).read_bytes() != b'hold\n':
            raise ValueError('invalid transport hold')
    else:
        durable_bytes(hold, b'hold\n')
    if not GATE.parent.exists():
        GATE.parent.mkdir(mode=0o755)
        sync_directory(GATE.parent.parent)
    info = GATE.parent.lstat()
    if GATE.parent.resolve(strict=True) != GATE.parent or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        raise ValueError('unsafe transport drop-in directory')
    if GATE.exists() or GATE.is_symlink():
        if regular(GATE).read_bytes() != gate_content(directory):
            raise ValueError('conflicting transport drop-in')
    else:
        durable_bytes(GATE, gate_content(directory), 0o644)
    command('systemctl', 'daemon-reload')
    command('systemctl', 'stop', TRANSPORT)
    if command('systemctl', 'show', '-p', 'ActiveState', '--value', TRANSPORT) != 'inactive':
        raise ValueError('transport did not stop')


def release_gate(directory, record):
    if regular(GATE).read_bytes() != gate_content(directory):
        raise ValueError('transport drop-in changed')
    hold = directory/'hold'
    if hold.exists() or hold.is_symlink():
        if regular(hold).read_bytes() != b'hold\n':
            raise ValueError('invalid transport hold')
        hold.unlink()
        sync_directory(directory)
    if record['transport_active']:
        try:
            if command('systemctl', 'show', '-p', 'ActiveState', '--value', TRANSPORT) != 'active':
                command('systemctl', 'start', TRANSPORT)
            if command('systemctl', 'show', '-p', 'ActiveState', '--value', TRANSPORT) != 'active':
                raise ValueError('transport did not start')
        except Exception:
            set_gate(directory)
            raise


def file_mode(target):
    path = regular(Path(target))
    if path.stat().st_gid != os.getegid():
        raise ValueError('unexpected code group')
    return stat.S_IMODE(path.stat().st_mode)


def check_files(mapping, record, sides):
    for target, value in inventory(mapping).items():
        if not any(value == record[side][target] for side in sides):
            raise ValueError('installed code drift')
        if value is not None and file_mode(target) != record['modes'][target]:
            raise ValueError('installed mode drift')


def snapshot(mapping, directory, approval, *, prior=None, verified_new=None):
    old = inventory(mapping)
    new = verified_new if verified_new is not None else {str(t):digest(s) for t,s in mapping.items()}
    required = {'old':old, 'new':new}
    if prior is not None:
        required['prior_journal_sha256'] = prior
    if approval != required:
        raise ValueError('migration approval mismatch')
    record = {'schema':2, 'phase':'staging', 'id':secrets.token_hex(16), 'old':old, 'new':new,
              'modes':{str(t):file_mode(t) if old[str(t)] is not None else 0o600 for t in mapping},
              'transport_active':command('systemctl','show','-p','ActiveState','--value',TRANSPORT)=='active'}
    if prior is not None:
        record['prior_journal_sha256'] = prior
    if not record['transport_active']:
        raise ValueError('transport must be active before migration')
    directory.mkdir(mode=0o700)
    sync_directory(directory.parent)
    persist(directory, record, 'staging')
    for target,source in mapping.items():
        saved = backup_path(directory,target)
        if old[str(target)] is not None:
            durable_bytes(saved, regular(target).read_bytes())
        durable_bytes(saved.with_name('new-'+saved.name), regular(source).read_bytes())
    verify_bundle(mapping,directory,record)
    check_files(mapping,record,('old',))
    persist(directory,record,'prepared')
    return record


def verify_bundle(mapping, directory, record):
    for target in mapping:
        saved = backup_path(directory,target)
        previous = record['old'][str(target)]
        if previous is not None and digest(saved) != previous:
            raise ValueError('backup digest changed')
        if digest(saved.with_name('new-'+saved.name)) != record['new'][str(target)]:
            raise ValueError('staged digest changed')


def persist(directory, record, phase):
    record['phase'] = phase
    durable_json(directory/'journal.json', record)


def current_record(mapping, directory):
    private_directory(directory)
    record = json.loads(regular(directory/'journal.json').read_text())
    paths = {str(target) for target in mapping}
    if (record.get('schema') != 2 or any(set(record[key]) != paths for key in ('old','new','modes'))
            or not re.fullmatch('[a-f0-9]{32}', record.get('id',''))):
        raise ValueError('migration journal scope')
    return record


def stop_trial():
    listing = command('systemctl','list-units','--all','--plain','--no-legend',TRIAL)
    if any(line.split()[0] == TRIAL for line in listing.splitlines() if line.split()):
        command('systemctl','stop',TRIAL)


def restore(mapping, directory, record, validate, *, terminal=False):
    phases = ('accepted', 'rollback') if terminal else ('installing', 'awaiting_probe', 'probing', 'restoring')
    if record['phase'] not in phases:
        raise ValueError('restoration phase')
    stop_trial()
    set_gate(directory)
    verify_bundle(mapping,directory,record)
    sides = ('new',) if record['phase'] == 'accepted' else ('old','new')
    check_files(mapping,record,sides)
    persist(directory,record,'rollback' if terminal else 'restoring')
    for target in mapping:
        saved = backup_path(directory,target)
        if record['old'][str(target)] is None:
            if target.exists() or target.is_symlink():
                if digest(target) != record['new'][str(target)]:
                    raise ValueError('new target changed')
                target.unlink()
                sync_directory(target.parent)
        else:
            replace_code(saved,target,record['modes'][str(target)])
    check_files(mapping,record,('old',))
    validate()
    persist(directory,record,'restored')
    release_gate(directory,record)
    return 'restored'


def begin(mapping, directory, approval, validate, *, prior=None, verified_new=None):
    if exists(directory):
        raise ValueError('existing migration requires inspection')
    record = snapshot(mapping,directory,approval,prior=prior,verified_new=verified_new)
    set_gate(directory)
    persist(directory,record,'installing')
    try:
        for target in mapping:
            saved = backup_path(directory,target)
            replace_code(saved.with_name('new-'+saved.name),target,record['modes'][str(target)])
        check_files(mapping,record,('new',))
        validate()
        persist(directory,record,'awaiting_probe')
    except Exception:
        return restore(mapping,directory,record,validate)
    return 'awaiting_probe'


def recover(mapping, directory, expected, validate):
    private_directory(directory)
    journal = directory/'journal.json'
    # No hold or code writes precede the first durable journal.
    if not journal.exists() and not journal.is_symlink():
        if any(not re.fullmatch(r'journal\.json\.[A-Za-z0-9_]+\.new', p.name) or
               regular(p) != p for p in directory.iterdir()):
            raise ValueError('unexpected pre-journal state')
        if exists(GATE):
            raise ValueError('unexpected pre-journal transport drop-in')
        prefix = directory.name + '-abandoned-'
        archive = directory.with_name(prefix+secrets.token_hex(16))
        os.rename(directory,archive)
        sync_directory(directory.parent)
        return 'abandoned_staging'
    record = current_record(mapping,directory)
    phase = record['phase']
    if phase in ('staging','prepared'):
        check_files(mapping,record,('old',))
        # In prepared, the hold may already be installed but no target changed.
        if (directory/'hold').exists():
            set_gate(directory)
        validate()
        persist(directory,record,'restored')
        if (directory/'hold').exists():
            release_gate(directory,record)
        return 'restored'
    if phase in TERMINAL:
        probe = record.get('probe')
        if (phase == 'accepted' or probe is not None) and (
                not isinstance(probe, dict) or probe.get('state') != expected):
            hold = directory/'hold'
            if not hold.exists():
                # A crash may have removed the marker before starting the service.
                set_gate(directory)
            raise ValueError('operational state changed since acceptance probe')
        side = 'new' if phase == 'accepted' else 'old'
        check_files(mapping,record,(side,))
        validate()
        if GATE.exists() or GATE.is_symlink():
            release_gate(directory,record)
        elif (directory/'hold').exists() or (directory/'hold').is_symlink():
            raise ValueError('missing transport drop-in')
        return phase
    return restore(mapping,directory,record,validate,terminal=phase=='rollback')


def open_probe(mapping, directory, expected):
    record = current_record(mapping,directory)
    if record['phase'] not in ('awaiting_probe','probing'):
        raise ValueError('probe phase')
    set_gate(directory)
    stop_trial()
    check_files(mapping,record,('new',))
    verify_bundle(mapping,directory,record)
    challenge = secrets.token_hex(32)
    record['probe'] = {'challenge':challenge, 'state':expected}
    persist(directory,record,'probing')
    try:
        command('systemd-run','--unit='+TRIAL,'--collect','--property=Type=exec',
                '--property=RuntimeMaxSec=120s','--property=Restart=no',
                '--property=User=funix-hml-ops','--property=Group=funix-hml-ops',
                '--property=UMask=0077','--property=PrivateTmp=true',
                '--property=ProtectSystem=full','--property=ProtectHome=true',
                '--property=InaccessiblePaths=/usr/local/sbin/funix-hml-ops-request',
                '--setenv=FUNIX_HML_MIGRATION_PROBE='+challenge,
                '/usr/bin/python3','-I','/usr/local/lib/funix-hml-ops/transport.py')
        invocation = command('systemctl','show','-p','InvocationID','--value',TRIAL)
        if not re.fullmatch('[a-f0-9]{32}',invocation):
            raise ValueError('probe invocation unavailable')
        record['probe']['invocation'] = invocation
        persist(directory,record,'probing')
    except Exception:
        stop_trial()
        raise
    return 'probing'


def accept(mapping, directory, response, expected, validate):
    record = current_record(mapping,directory)
    if record['phase'] != 'probing':
        raise ValueError('accept phase')
    probe = record['probe']
    try:
        last = response.get('last_request')
        observed = ({key:last.get(key) for key in expected['last_request']}
                    if isinstance(last,dict) and expected['last_request'] is not None else last)
        if (probe.get('invocation') is None
                or command('systemctl','show','-p','InvocationID','--value',TRIAL) != probe['invocation']
                or command('systemctl','show','-p','ActiveState','--value',TRIAL) != 'active'
                or response.get('migration_probe') != probe['challenge']
                or response.get('schema') != 'funix-hml-ops/1' or response.get('scope') != 'funix-hml'
                or response.get('status') != 'ok' or 'armed' not in response or response['armed'] is not None
                or 'last_request' not in response or observed != expected['last_request']
                or response.get('journal') != expected['journal'] or expected != probe['state']):
            raise ValueError('invalid mTLS probe evidence')
        check_files(mapping,record,('new',))
        verify_bundle(mapping,directory,record)
        validate()
    finally:
        stop_trial()
    persist(directory,record,'accepted')
    release_gate(directory,record)
    return 'accepted'


def rollback(mapping, directory, approval, expected, validate):
    record = current_record(mapping,directory)
    required = {key:record[key] for key in ('id','old','new')}
    if 'prior_journal_sha256' in record:
        required['prior_journal_sha256'] = record['prior_journal_sha256']
    if approval != required:
        raise ValueError('rollback approval mismatch')
    if record.get('probe', {}).get('state') != expected:
        raise ValueError('operational state changed since acceptance')
    return restore(mapping,directory,record,validate,terminal=True)


def migration_inventory(mapping, original, retry):
    result = {'old':inventory(mapping), 'new':source_integrity(mapping)}
    for label,directory in (('migration',original),('migration_retry',retry)):
        if not exists(directory):
            continue
        private_directory(directory)
        journal = directory/'journal.json'
        if not exists(journal):
            result[label] = {'phase':'pre_journal'}
            continue
        record = json.loads(regular(journal).read_bytes())
        if record.get('schema') == 2:
            record = current_record(mapping,directory)
        result[label] = {key:record[key] for key in
                         ('schema','id','phase','old','new','prior_journal_sha256') if key in record}
        if label == 'migration' and record.get('schema') == 1 and record.get('phase') == 'restored':
            result[label]['journal_sha256'] = prior_restoration(mapping,original)
    return result


def accepted_baseline(mapping, original, retry):
    """Accept either the original restored journal or an accepted retry."""
    original_digest = prior_restoration(mapping, original)
    if not exists(retry):
        prior_restoration(mapping, original, require_installed_old=True)
        baseline = {
            'old': inventory(mapping),
            'new': inventory(mapping),
            'modes': {str(target): file_mode(target) for target in mapping},
        }
        return original_digest, baseline

    baseline = current_record(mapping, retry)
    if baseline['phase'] != 'accepted' or exists(retry/'hold'):
        raise ValueError('previous migration is not accepted')
    if baseline.get('prior_journal_sha256') != original_digest:
        raise ValueError('previous migration history changed')
    verify_bundle(mapping, retry, baseline)
    check_files(mapping, baseline, ('new',))
    return digest(retry/'journal.json'), baseline


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('inventory','inventory-upgrade','apply','probe','accept','recover','rollback',*RETRY_ACTIONS,*UPGRADE_ACTIONS))
    parser.add_argument('--authorize',action='store_true')
    args=parser.parse_args()
    if os.geteuid()!=0: raise ValueError('local administrator required')
    execute(args.action,args.authorize)


def execute(requested_action, authorized):
    mapping=targets()
    private_directory(STATE); private_directory(UPDATER)
    original = STATE/'migration'
    retry = STATE/'migration-retry'
    upgrade = STATE/'migration-controller-permits'
    with locks():
        expected = idle()
        if requested_action == 'inventory-upgrade':
            prior, baseline = accepted_baseline(mapping, original, retry)
            if exists(upgrade):
                state = current_record(mapping, upgrade)
                if state.get('prior_journal_sha256') != prior:
                    raise ValueError('upgrade history binding changed')
                print(json.dumps({'phase':state['phase'],'id':state['id']}))
            else:
                check_files(mapping, baseline, ('new',))
                print(json.dumps({'old':inventory(mapping), 'new':source_integrity(mapping),
                                  'prior_journal_sha256':prior}, sort_keys=True))
            return
        if requested_action=='inventory':
            print(json.dumps(migration_inventory(mapping,original,retry),sort_keys=True))
            return
        if not authorized: raise ValueError('administrative authorization required')

        is_retry = requested_action in RETRY_ACTIONS
        is_upgrade = requested_action in UPGRADE_ACTIONS
        action = UPGRADE_ACTIONS.get(requested_action, RETRY_ACTIONS.get(requested_action, requested_action))
        directory = upgrade if is_upgrade else retry if is_retry else original
        prior = None
        if is_upgrade:
            prior, baseline = accepted_baseline(mapping, original, retry)
            if action == 'apply':
                check_files(mapping, baseline, ('new',))
        elif exists(upgrade):
            raise ValueError('controller upgrade requires explicit upgrade action')
        elif is_retry:
            prior = prior_restoration(mapping,original,require_installed_old=action == 'apply')
        elif exists(retry):
            raise ValueError('retry requires explicit retry action')

        if action == 'apply':
            if exists(directory) or exists(GATE):
                raise ValueError('existing migration or transport drop-in requires inspection')
        else:
            private_directory(directory)
            if exists(GATE) and regular(GATE).read_bytes() != gate_content(directory):
                raise ValueError('transport drop-in belongs to another attempt')
            if action != 'recover' or exists(directory/'journal.json'):
                record = current_record(mapping,directory)
                if record.get('prior_journal_sha256') != prior:
                    raise ValueError('migration history binding changed')

        def authorization(name):
            path = regular(STATE/name)
            if stat.S_IMODE(path.stat().st_mode) != 0o600:
                raise ValueError('private administrative approval required')
            return json.loads(path.read_text())

        def validate():
            command('/usr/bin/python3','-I','-B','-c',"import importlib.util; s=importlib.util.spec_from_file_location('r','/usr/local/lib/funix-hml-ops/rootctl.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.prep_module().load_updater('')")
        if action == 'apply':
            name = directory.name + '-approval.json' if is_upgrade else 'migration-approval-retry.json' if is_retry else 'migration-approval.json'
            new = source_integrity(mapping)
            result = begin(mapping,directory,authorization(name),validate,prior=prior,verified_new=new)
        elif action == 'probe':
            result = open_probe(mapping,directory,expected)
        elif action == 'accept':
            if record['phase'] != 'probing':
                raise ValueError('accept phase')
            import sys
            try:
                response = sys.stdin.buffer.read(32769)
                if len(response) > 32768:
                    raise ValueError('probe evidence size')
                response = json.loads(response)
            except Exception:
                stop_trial()
                raise
            result = accept(mapping,directory,response,expected,validate)
        elif action == 'rollback':
            name = directory.name + '-rollback-approval.json' if is_upgrade else 'migration-rollback-approval-retry.json' if is_retry else 'migration-rollback-approval.json'
            result = rollback(mapping,directory,authorization(name),expected,validate)
        else:
            result = recover(mapping,directory,expected,validate)
        print(json.dumps({'scope':'funix-hml','migration':result,'attempt':'upgrade' if is_upgrade else 'retry' if is_retry else 'original'}))


if __name__=='__main__':
    try: main()
    except Exception: raise SystemExit('BLOCKED: inspect private migration journal')
