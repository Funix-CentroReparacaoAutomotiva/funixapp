import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SPEC=importlib.util.spec_from_file_location('selection',Path(__file__).resolve().parents[1]/'hml-selection.py')
m=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(m)


class SelectionTest(unittest.TestCase):
    def fixture(self,archive,index):
        with zipfile.ZipFile(archive, 'w') as bundle:
            bundle.writestr('manifest.json', json.dumps({'synthetic_candidate': index}))
        value=dict(pr=index,run_id=index+100,attempt=1,artifact_id=index+200,
                   revision=str(index)*40,sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),size=archive.stat().st_size)
        p=m.module('hml-artifact-provenance')
        artifact=dict(id=value['artifact_id'],size_in_bytes=value['size'],expired=False,
                      name=f"funix-hml-{value['revision']}-1",workflow_run={'id':value['run_id']},digest='sha256:'+value['sha256'])
        run=dict(id=value['run_id'],run_attempt=1,event='workflow_dispatch',head_branch='main',path=p.WORKFLOW,
                 status='completed',conclusion='success',repository={'full_name':p.REPO})
        pr={'head':{'sha':value['revision'],'repo':{'full_name':p.REPO}},'base':{'ref':'main'}}
        def query(path): return artifact if 'artifacts/' in path else pr if path.startswith('pulls/') else run
        return value,artifact,run,pr,query

    def test_two_candidates_read_only_and_not_authorized(self):
        with tempfile.TemporaryDirectory() as directory:
            for index in (1,2):
                archive=Path(directory)/f'{index}.zip'
                value,_,_,_,query=self.fixture(archive,index)
                output=m.verify_package(m.parse(json.dumps(value).encode()),archive,query=query)
                self.assertFalse(output['update_authorized'])
                self.assertLess(len(json.dumps(output)),1024)
                self.assertEqual(output['operation'],m.operation_id(value))
            self.assertEqual(len(list(Path(directory).iterdir())),2)

    def test_size_bound_matches_privileged_controller(self):
        self.assertEqual(m.MAX_SIZE, 1024**3)
        value = dict(pr=1, run_id=101, attempt=1, artifact_id=201,
                     revision='a'*40, sha256='b'*64, size=1024**3)
        self.assertEqual(m.selection(value)['size'], 1024**3)
        for excess in (1024**3 + 1, 20 * 1024**3):
            with self.subTest(size=excess), self.assertRaises(ValueError):
                m.selection(dict(value, size=excess))
        for invalid in (0, -1, 1.0, True, '1024'):
            with self.subTest(size=invalid), self.assertRaises(ValueError):
                m.selection(dict(value, size=invalid))

    def test_identity_digest_expiration_and_untrusted_workflow_block(self):
        with tempfile.TemporaryDirectory() as directory:
            archive=Path(directory)/'artifact.zip'
            for field in ('revision','digest','size','expired','workflow'):
                value,artifact,run,pr,query=self.fixture(archive,1)
                if field=='revision': pr['head']['sha']='f'*40
                if field=='digest': artifact['digest']='sha256:'+'f'*64
                if field=='size': artifact['size_in_bytes']+=1
                if field=='expired': artifact['expired']=True
                if field=='workflow': run['path']='untrusted.yml'
                with self.subTest(field=field),self.assertRaisesRegex(ValueError,'rejected'):
                    m.verify_package(value,archive,query=query)

    def test_no_url_path_shell_or_duplicate_fields(self):
        for body in (b'{"pr":1,"pr":2}',b'[]',b'\xff',b'x'*4097,b'['*1500+b']'*1500):
            with self.assertRaises(ValueError): m.parse(body)
        with tempfile.TemporaryDirectory() as directory:
            value,*_=self.fixture(Path(directory)/'artifact.zip',1)
            for key in ('url','path','shell','environment','project'):
                with self.assertRaises(ValueError): m.selection(dict(value,**{key:'SENSITIVE_MARKER'}))

    def test_replay_concurrency_and_pending_are_host_preconditions(self):
        m.require_available(lock_acquired=True,operation_exists=False,active_phase='restored')
        for options in (dict(lock_acquired=False,operation_exists=False,active_phase='accepted'),
                        dict(lock_acquired=True,operation_exists=True,active_phase='accepted'),
                        dict(lock_acquired=True,operation_exists=False,active_phase='installing')):
            with self.assertRaises((ValueError,BlockingIOError)): m.require_available(**options)

    def test_tampered_archive_symlink_and_ambiguous_metadata_block(self):
        with tempfile.TemporaryDirectory() as directory:
            archive=Path(directory)/'artifact.zip'
            value,artifact,_,_,query=self.fixture(archive,1)
            archive.write_bytes(b'changed')
            with self.assertRaises(ValueError): m.verify_package(value,archive,query=query)
            value,artifact,_,_,query=self.fixture(archive,1)
            link=Path(directory)/'link.zip'; link.symlink_to(archive)
            with self.assertRaisesRegex(ValueError, '^selection provenance rejected$'):
                m.verify_package(value,link,query=query)
            with self.assertRaisesRegex(ValueError, '^selection provenance rejected$'):
                m.verify_package(value,archive.parent/'missing.zip',query=query)
            for changed in (dict(artifact, id=999), dict(artifact, size_in_bytes=float(value['size']))):
                # A mismatched response between two valid snapshots must fail closed.
                responses = iter((artifact, changed, artifact))

                def changing(path):
                    return next(responses) if path.startswith('actions/artifacts/') else query(path)

                with self.subTest(changed=changed), self.assertRaisesRegex(
                        ValueError, '^selection provenance rejected$'):
                    m.verify_package(value,archive,query=changing)

    def test_partial_metadata_failure_is_sanitized_and_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory)/'artifact.zip'
            value, _, _, _, query = self.fixture(archive, 1)
            original = archive.read_bytes()

            def unavailable(path):
                if path.startswith('pulls/'):
                    raise OSError('SENSITIVE_MARKER')
                return query(path)

            with self.assertRaisesRegex(ValueError, '^selection provenance rejected$'):
                m.verify_package(value, archive, query=unavailable)
            self.assertEqual(archive.read_bytes(), original)
            self.assertEqual(list(archive.parent.iterdir()), [archive])
