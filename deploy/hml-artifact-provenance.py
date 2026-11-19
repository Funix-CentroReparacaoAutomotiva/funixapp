"""Authenticate an Actions artifact against GitHub metadata and ZIP digest.

Call before extracting the downloaded artifact. Local manifest checks alone
are not provenance. Optional authentication uses FUNIX_HML_GITHUB_TOKEN.
"""
import hashlib
import json
import os
import ssl
from urllib.request import Request, build_opener, HTTPSHandler, HTTPRedirectHandler
from pathlib import Path

REPO = "Funix-CentroReparacaoAutomotiva/funixapp"
WORKFLOW = ".github/workflows/funix-hml-candidate.yml"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def api(path):
    """Official HTTPS API; optional fine-grained read-only token, never gh."""
    if not isinstance(path, str) or path.startswith("/") or ".." in path or ":" in path:
        raise ValueError("invalid GitHub API path")
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
               "User-Agent": "funix-hml-provenance"}
    token = os.environ.get("FUNIX_HML_GITHUB_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    request = Request(f"https://api.github.com/repos/{REPO}/{path}", headers=headers)
    try:
        opener = build_opener(HTTPSHandler(context=ssl.create_default_context()), NoRedirect())
        with opener.open(request, timeout=15) as response:
            body = response.read(2 * 1024**2 + 1)
            if response.status != 200 or len(body) > 2 * 1024**2:
                raise ValueError()
            data = json.loads(body)
            if not isinstance(data, dict):
                raise ValueError()
            return data
    except Exception:
        raise ValueError("GitHub metadata unavailable, unauthorized or invalid") from None


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
