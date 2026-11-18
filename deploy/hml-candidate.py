#!/usr/bin/env python3
"""Fail-closed selection of a reviewed, tested, same-repository PR revision."""
import json
import os
import re
import sys
from urllib.request import Request, urlopen

REPO = "Funix-CentroReparacaoAutomotiva/funixapp"
REQUIRED = frozenset(
    ".github/workflows/" + name + ".yml"
    for name in (
        "funix", "atendimento-vehicle-browser", "chat-readonly-browser",
        "customer-experience-browser", "diagnosis-quote-browser",
        "issue-123-pdf-preview-browser", "os-flow-browser", "updates-browser",
        "voice-pr3-browser", "voice-pr3-check",
    )
)


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


def check_candidate(pr, runs_response, number, revision):
    head, base = pr["head"], pr["base"]
    if (pr["number"] != number or pr["state"] != "open"
            or head["sha"] != revision or base["ref"] != "main"
            or head["repo"]["full_name"].lower() != REPO.lower()
            or base["repo"]["full_name"].lower() != REPO.lower()):
        raise Blocked("PR closed, changed, forked or targets another branch")
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
    if not REQUIRED.issubset(latest):
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
        runs = api("actions/runs?event=pull_request&head_sha="
                   + revision + "&per_page=100")
        result = check_candidate(pr, runs, number, revision)
        # Recheck after CI query to catch a changed PR head.
        check_candidate(api(f"pulls/{number}"), runs, number, revision)
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
