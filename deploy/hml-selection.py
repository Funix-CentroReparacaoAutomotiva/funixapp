"""Increment A pure selection boundary. No service, download, state write or update.

Host callers must own the official lock and immutable root-owned registration.
Those controller adapters are intentionally not implemented without their sources.
"""
import importlib.util
import json
from pathlib import Path
import re

KEYS = {'pr','run_id','attempt','artifact_id','revision','sha256','size'}
MAX_SIZE = 20 * 1024**3


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    value=importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


def selection(value):
    if not isinstance(value,dict) or set(value)!=KEYS:
        raise ValueError('invalid selection fields')
    for key in ('pr','run_id','attempt','artifact_id'):
        if type(value[key]) is not int or not 0 < value[key] <= 2**63-1:
            raise ValueError('invalid selection identity')
    if (not isinstance(value['revision'],str) or not re.fullmatch('[a-f0-9]{40}',value['revision'])
            or not isinstance(value['sha256'],str) or not re.fullmatch('[a-f0-9]{64}',value['sha256'])
            or type(value['size']) is not int or not 0 < value['size'] <= MAX_SIZE):
        raise ValueError('invalid selection revision/digest/size')
    return dict(value)


def parse(body):
    if not isinstance(body,bytes) or not 0 < len(body) <= 4096:
        raise ValueError('invalid selection body')
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result: raise ValueError('duplicate selection field')
            result[key]=value
        return result
    try:
        return selection(json.loads(body,object_pairs_hook=unique))
    except (ValueError, RecursionError):
        raise ValueError('invalid selection') from None


def operation_id(value):
    value=selection(value)
    return f"op-{value['run_id']}-{value['attempt']}-prep-{value['artifact_id']}"


def require_available(*, lock_acquired, operation_exists, active_phase):
    """Trusted host facts only, never request fields. No alternate lock/registry."""
    if lock_acquired is not True: raise BlockingIOError('official lock required')
    if operation_exists is not False: raise ValueError('existing operation requires inspection')
    if active_phase not in ('accepted','restored'):
        raise ValueError('active journal requires recovery/inspection')


def verify_package(value, archive, *, query=None):
    """Read-only ZIP identity proof, supplementing the official verifier.

    Archive is a canonical host-controlled path, never part of client selection.
    Manifest/extraction/preparation remain prepare_operation's responsibility.
    """
    value=selection(value)
    safety=module('hml-update-safety')
    provenance=module('hml-artifact-provenance')
    query=provenance.api if query is None else query
    artifact_path = f"actions/artifacts/{value['artifact_id']}"
    try:
        archive = safety.regular(Path(archive))
        artifact = query(artifact_path)
        if (type(artifact.get('id')) is not int or artifact['id']!=value['artifact_id']
                or type(artifact.get('size_in_bytes')) is not int or artifact['size_in_bytes']!=value['size']
                or artifact.get('digest')!='sha256:'+value['sha256']
                or archive.stat().st_size!=value['size']):
            raise ValueError('artifact selection mismatch')
        # Use the same metadata for selection and official provenance.
        snapshot = json.dumps(artifact, sort_keys=True)

        def verified_query(path):
            if path == artifact_path:
                return artifact
            return query(path)

        result=provenance.verify(archive,artifact_id=value['artifact_id'],run_id=value['run_id'],
            attempt=value['attempt'],revision=value['revision'],pr=value['pr'],query=verified_query)
        if result['digest']!='sha256:'+value['sha256']:
            raise ValueError('artifact digest mismatch')
        # Re-read to reject changed/ambiguous metadata, not just an initial snapshot.
        if json.dumps(query(artifact_path), sort_keys=True) != snapshot:
            raise ValueError('artifact metadata changed')
    except Exception:
        raise ValueError('selection provenance rejected') from None
    return {'schema':'funix-hml-selection/1','scope':'funix-hml','selection':value,
            'operation':operation_id(value),'status':'verified','update_authorized':False}
