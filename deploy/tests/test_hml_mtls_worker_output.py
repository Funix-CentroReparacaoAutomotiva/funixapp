"""Worker output boundary with real subprocess bytes; updater effects simulated."""
import contextlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

ROOT=Path(__file__).resolve().parents[1]
def load(path):
    spec=importlib.util.spec_from_file_location(path.stem,path)
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


def worker_rehearsal():
    ctl=load(ROOT/'remote-hml/rootctl.py'); coordinator=load(ROOT/'hml-official-update.py')
    with tempfile.TemporaryDirectory() as directory:
        root=Path(directory); op=root/'op-test'; op.mkdir(); request=root/'request'; request.mkdir()
        old=root/'old.json'; old.write_text('{}')
        previous={'revision':'a'*40}; candidate={'revision':'c'*40}
        cfg={'identity':{'revision':'c'*40},'candidate':candidate}
        preview=dict(action='update',scope='funix-hml',operation=op.name,revision='c'*40,
                     sha256='b'*64,config_sha256='b'*64,prepared_sha256='b'*64,active_journal_sha256='b'*64)
        now=int(time.time())
        ticket=dict(schema=ctl.SCHEMA,ticket_id='d'*32,issued_at=now,expires_at=now+1200,
                    preview=preview,preview_sha256=ctl.hash_obj(preview))
        p=Mock(); p.external_snapshot.return_value={}; p.sha.return_value='b'*64
        p.effective_release.return_value=(previous,None)
        p.read_json.side_effect=lambda path: json.loads(Path(path).read_text())
        u=Mock(); u.load.return_value=coordinator
        old_record={'phase':'accepted','candidate':previous,'previous':previous}
        def active(_):
            return (op/'operation.json',json.loads((op/'operation.json').read_text())) if (op/'operation.json').exists() else (old,old_record)
        def installed(_): return candidate if (op/'operation.json').exists() else previous
        u.installed_preflight.side_effect=installed
        def execute(*args,**kwargs):
            u.checked_update_package(cfg,Mock())
            subprocess.run([sys.executable,'-c',"import os; os.write(1,b'SENSITIVE_WORKER\\n'); os.write(2,b'\\xffSENSITIVE_WORKER\\n')"],check=True)
            (op/'operation.json').write_text(json.dumps(dict(phase='accepted',candidate=candidate,previous=previous,backup_sha256='b'*64)))
        u.execute_operation.side_effect=execute
        with patch.object(ctl,'locked',side_effect=contextlib.nullcontext), \
             patch.object(ctl,'current_request',return_value=(request,ticket)), \
             patch.object(ctl,'context',return_value=(p,u,{},'synthetic',op,cfg,old,old_record,previous,preview)), \
             patch.object(ctl,'active_record',side_effect=active):
            result=ctl.worker()
        assert result==json.loads((request/'result.json').read_text())
        print(json.dumps(result))


class WorkerOutputTest(unittest.TestCase):
    def test_subprocess_output_does_not_escape_and_result_is_persisted(self):
        result=subprocess.run([sys.executable,'-c',
            'from deploy.tests.test_hml_mtls_worker_output import worker_rehearsal; worker_rehearsal()'],
            cwd=ROOT.parent,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn('SENSITIVE_WORKER',result.stdout+result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'],'accepted')
