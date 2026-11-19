import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError

SPEC = importlib.util.spec_from_file_location("provenance", Path(__file__).resolve().parents[1] / "hml-artifact-provenance.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class ProvenanceTest(unittest.TestCase):
    def test_https_api_without_gh_and_private_token(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = b'{"id":12}'
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(module, "build_opener", return_value=opener), \
             patch.dict(module.os.environ, {"FUNIX_HML_GITHUB_TOKEN": "synthetic"}):
            self.assertEqual(module.api("actions/runs/12"), {"id": 12})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.github.com/repos/" + module.REPO + "/actions/runs/12")
        self.assertEqual(request.get_header("Authorization"), "Bearer synthetic")

    def test_unauthorized_invalid_and_oversized_responses_block(self):
        for body in (b"not json", b"[]", b"x" * (2 * 1024**2 + 1)):
            response = MagicMock()
            response.__enter__.return_value = response
            response.status = 200
            response.read.return_value = body
            opener = MagicMock()
            opener.open.return_value = response
            with patch.object(module, "build_opener", return_value=opener), self.assertRaises(ValueError):
                module.api("actions/runs/12")
        opener.open.side_effect = HTTPError("https://api.github.com", 401, "secret", {}, None)
        with patch.object(module, "build_opener", return_value=opener), self.assertRaisesRegex(ValueError, "unauthorized"):
            module.api("actions/runs/12")
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
            for record, key, bad in ((artifact, "expired", True), (artifact, "name", "other"),
                                     (run, "run_attempt", 2), (run, "conclusion", "failure"),
                                     (pr["head"], "sha", "b" * 40)):
                original = record[key]
                record[key] = bad
                with self.assertRaises(ValueError):
                    module.verify(archive, **args)
                record[key] = original
            archive.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "digest"):
                module.verify(archive, **args)
