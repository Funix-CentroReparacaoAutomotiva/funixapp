import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("provenance", Path(__file__).resolve().parents[1] / "hml-artifact-provenance.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class ProvenanceTest(unittest.TestCase):
    def test_authenticated_metadata_binds_download_and_rejects_tampering(self):
        revision = "a" * 40
        run = dict(id=12, run_attempt=1, event="workflow_dispatch", head_branch="main",
                   path=module.WORKFLOW, status="completed", conclusion="success",
                   repository={"full_name": module.REPO})
        artifact = dict(expired=False, name=f"funix-hml-{revision}-1", workflow_run={"id": 12},
                        digest="sha256:" + hashlib.sha256(b"zip").hexdigest())
        pr = {"head": {"sha": revision, "repo": {"full_name": module.REPO}}, "base": {"ref": "main"}}
        def query(path):
            return pr if path.startswith("pulls/") else artifact if "artifacts/" in path else run
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "artifact.zip"
            archive.write_bytes(b"zip")
            args = dict(artifact_id=4, run_id=12, attempt=1, revision=revision, pr=262, query=query)
            module.verify(archive, **args)
            archive.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "digest"):
                module.verify(archive, **args)
