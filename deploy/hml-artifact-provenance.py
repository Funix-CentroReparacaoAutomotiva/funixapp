"""Authenticate an Actions artifact against GitHub metadata and ZIP digest.

Call before extracting the downloaded artifact. Local manifest checks alone
are not provenance. Authentication uses the caller's existing gh session.
"""
import hashlib
import json
import subprocess
from pathlib import Path

REPO = "Funix-CentroReparacaoAutomotiva/funixapp"
WORKFLOW = ".github/workflows/funix-hml-candidate.yml"


def api(path):
    result = subprocess.run(["gh", "api", f"repos/{REPO}/{path}"],
                            capture_output=True, text=True, check=False)
    if result.returncode:
        raise ValueError("GitHub provenance query failed")
    return json.loads(result.stdout)


def verify(archive, *, artifact_id, run_id, attempt, revision, pr, query=api):
    for value in (artifact_id, run_id, attempt, pr):
        if type(value) is not int or value <= 0:
            raise ValueError("invalid provenance identity")
    run = query(f"actions/runs/{run_id}/attempts/{attempt}")
    expected = {
        "id": run_id, "run_attempt": attempt, "event": "workflow_dispatch",
        "head_branch": "main", "path": WORKFLOW,
        "status": "completed", "conclusion": "success",
    }
    if any(run.get(key) != value for key, value in expected.items()):
        raise ValueError("untrusted workflow run")
    if run.get("repository", {}).get("full_name") != REPO:
        raise ValueError("wrong workflow repository")
    artifact = query(f"actions/artifacts/{artifact_id}")
    if (artifact.get("expired") is not False
            or artifact.get("name") != f"funix-hml-{revision}-{attempt}"
            or artifact.get("workflow_run", {}).get("id") != run_id):
        raise ValueError("artifact identity mismatch")
    with Path(archive).open("rb") as stream:
        digest = "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()
    if artifact.get("digest") != digest:
        raise ValueError("authenticated artifact digest mismatch")
    candidate = query(f"pulls/{pr}")
    if (candidate.get("head", {}).get("sha") != revision
            or candidate.get("head", {}).get("repo", {}).get("full_name") != REPO
            or candidate.get("base", {}).get("ref") != "main"):
        raise ValueError("candidate PR identity mismatch")
    # This confirms trusted workflow + artifact bytes, not that PR code is safe.
    return {"artifact_id": artifact_id, "run_id": run_id, "attempt": attempt,
            "revision": revision, "pr": pr, "digest": digest}
