#!/usr/bin/env python3
"""Fail-closed selection of a reviewed, tested, same-repository PR revision."""
import json
import os
import re
import sys
from urllib.request import Request, urlopen

REPO = "Funix-CentroReparacaoAutomotiva/funixapp"
REQUIRED_APP = frozenset(
    ".github/workflows/" + name + ".yml"
    for name in (
        "funix", "atendimento-vehicle-browser", "chat-readonly-browser",
        "customer-experience-browser", "diagnosis-quote-browser",
        "issue-123-pdf-preview-browser", "os-flow-browser", "updates-browser",
        "voice-pr3-browser", "voice-pr3-check",
    )
)
REQUIRED_HML = frozenset({
    ".github/workflows/funix.yml",
    ".github/workflows/hml-system-boundary.yml",
    ".github/workflows/hml-maintenance-rehearsal.yml",
})
HML_ONLY_PATHS = (
    re.compile(r"deploy/remote-hml/.+"),
    re.compile(r"deploy/hml-[a-z0-9_-]+\.py"),
    re.compile(r"deploy/tests/(?:test_hml_[a-z0-9_-]+|hml_[a-z0-9_-]+)\.py"),
    re.compile(r"\.github/workflows/funix-hml-[a-z0-9_-]+\.yml"),
    re.compile(r"docs/hml/.+"),
)


def changed_paths(response):
    if not isinstance(response, list) or not response or len(response) >= 100:
        raise Blocked("incomplete PR file listing")
    paths = []
    for item in response:
        path = item.get("filename") if isinstance(item, dict) else None
        if (not isinstance(path, str) or not path or path.startswith("/")
                or ".." in path.split("/")):
            raise Blocked("invalid PR file listing")
        paths.append(path)
    if len(set(paths)) != len(paths):
        raise Blocked("duplicate PR file listing")
    return tuple(sorted(paths))


def hml_only_path(path):
    return any(pattern.fullmatch(path) for pattern in HML_ONLY_PATHS)


def required_for_paths(paths):
    if not paths:
        raise Blocked("empty PR file listing")
    has_hml = any(hml_only_path(path) for path in paths)
    if all(hml_only_path(path) for path in paths):
        return REQUIRED_HML
    if has_hml:
        return REQUIRED_APP | REQUIRED_HML
    return REQUIRED_APP


class Blocked(ValueError):
    pass


def validate_inputs(number, revision, authorized, ref, repository):
    if ref != "refs/heads/main" or repository.lower() != REPO.lower():
        raise Blocked("dispatch must use trusted main in FUNIX repository")
    if authorized != "true":
        raise Blocked("explicit review/authorization required")
    if not re.fullmatch(r"[1-9][0-9]{0,9}", number):
        raise Blocked("invalid PR number")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise Blocked("exact lowercase SHA-40 required")
    return int(number)


def check_candidate(pr, runs_response, number, revision, main_comparison=None, required_workflows=REQUIRED_APP):
    head, base = pr["head"], pr["base"]
    if (pr["number"] != number or head["sha"] != revision or base["ref"] != "main"
            or head["repo"]["full_name"].lower() != REPO.lower()
            or base["repo"]["full_name"].lower() != REPO.lower()):
        raise Blocked("PR changed, forked or targets another branch")
    if pr["state"] == "open":
        pass
    elif pr["state"] == "closed" and pr.get("merged") is True:
        merge_sha = pr.get("merge_commit_sha")
        if not isinstance(merge_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", merge_sha):
            raise Blocked("merged PR has no valid merge commit")
        if (not isinstance(main_comparison, dict)
                or main_comparison.get("status") not in ("ahead", "identical")
                or main_comparison.get("behind_by") != 0
                or main_comparison.get("base_commit", {}).get("sha") != merge_sha):
            raise Blocked("merged PR is not contained in main")
    else:
        raise Blocked("PR is neither open nor merged")
    runs = runs_response["workflow_runs"]
    if runs_response["total_count"] != len(runs):
        raise Blocked("incomplete or oversized CI run listing")
    latest = {}
    for run in runs:
        if run.get("event") != "pull_request" or run.get("head_sha") != revision:
            continue
        if not any(
            item.get("number") == number
            and item.get("head", {}).get("sha") == revision
            and item.get("base", {}).get("ref") == "main"
            for item in run.get("pull_requests", [])
        ):
            continue
        path = run["path"]
        key = (int(run["run_number"]), int(run["run_attempt"]), int(run["id"]))
        if path not in latest or key > latest[path][0]:
            latest[path] = (key, run)
    if not required_workflows.issubset(latest):
        raise Blocked("missing required PR workflows for exact revision")
    for _, run in latest.values():
        if run["status"] != "completed" or run["conclusion"] != "success":
            raise Blocked("a matching latest PR workflow is not successful")
    return revision


def api(path):
    request = Request(
        "https://api.github.com/repos/" + REPO + "/" + path,
        headers={
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    try:
        revision = os.environ["HML_REVISION"]
        number = validate_inputs(
            os.environ["HML_PR"], revision, os.environ["HML_AUTHORIZED"],
            os.environ["GITHUB_REF"], os.environ["GITHUB_REPOSITORY"],
        )
        pr = api(f"pulls/{number}")
        paths = changed_paths(api(f"pulls/{number}/files?per_page=100"))
        required = required_for_paths(paths)
        runs = api("actions/runs?event=pull_request&head_sha="
                   + revision + "&per_page=100")
        comparison = None
        if pr.get("state") == "closed" and pr.get("merged") is True:
            merge_sha = pr.get("merge_commit_sha")
            if not isinstance(merge_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", merge_sha):
                raise Blocked("merged PR has no valid merge commit")
            comparison = api(f"compare/{merge_sha}...main")
        result = check_candidate(pr, runs, number, revision, comparison, required)
        # Recheck PR identity, merge inclusion and CI after metadata queries.
        current_pr = api(f"pulls/{number}")
        current_paths = changed_paths(api(f"pulls/{number}/files?per_page=100"))
        if current_paths != paths:
            raise Blocked("PR file listing changed")
        current_required = required_for_paths(current_paths)
        current_runs = api("actions/runs?event=pull_request&head_sha="
                           + revision + "&per_page=100")
        current_comparison = None
        if current_pr.get("state") == "closed" and current_pr.get("merged") is True:
            merge_sha = current_pr.get("merge_commit_sha")
            if not isinstance(merge_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", merge_sha):
                raise Blocked("merged PR has no valid merge commit")
            current_comparison = api(f"compare/{merge_sha}...main")
        check_candidate(current_pr, current_runs, number, revision, current_comparison, current_required)
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(f"revision={result}\npr={number}\n")
        print(f"Candidate approved for isolated build: PR {number} {result}")
        return 0
    except Blocked as error:
        print("BLOCKED:", error, file=sys.stderr)
    except Exception:
        print("BLOCKED: unable to verify candidate metadata or CI", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
