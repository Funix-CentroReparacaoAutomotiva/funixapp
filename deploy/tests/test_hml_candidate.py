import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "hml_candidate", Path(__file__).resolve().parents[1] / "hml-candidate.py"
)
assert spec and spec.loader
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
SHA = "a" * 40


class CandidateGateTest(unittest.TestCase):
    def setUp(self):
        repo = {"full_name": gate.REPO}
        self.pr = {"number": 42, "state": "open", "draft": True,
                   "head": {"sha": SHA, "repo": repo},
                   "base": {"ref": "main", "repo": repo}}
        self.runs = [
            {"id": i, "run_number": 1, "run_attempt": 1, "path": path,
             "head_sha": SHA, "event": "pull_request",
             "pull_requests": [{"number": 42, "head": {"sha": SHA},
                                "base": {"ref": "main"}}],
             "status": "completed", "conclusion": "success"}
            for i, path in enumerate(sorted(gate.REQUIRED), 1)
        ]

    def check(self):
        return gate.check_candidate(self.pr,
            {"total_count": len(self.runs), "workflow_runs": self.runs}, 42, SHA)

    def check_merged(self, comparison):
        return gate.check_candidate(self.pr,
            {"total_count": len(self.runs), "workflow_runs": self.runs},
            42, SHA, comparison)

    def test_accept_reviewed_exact_revision(self):
        self.assertEqual(gate.validate_inputs("42", SHA, "true", "refs/heads/main",
                                             gate.REPO), 42)
        self.assertEqual(self.check(), SHA)

    def test_input_guards(self):
        good = ["42", SHA, "true", "refs/heads/main", gate.REPO]
        for i, bad in enumerate(["42; echo bad", "main", "false",
                                 "refs/heads/other", "other/repo"]):
            args = good.copy()
            args[i] = bad
            with self.subTest(i=i), self.assertRaises(gate.Blocked):
                gate.validate_inputs(*args)

    def test_wrong_pr_fork_changed_or_base(self):
        original = copy.deepcopy(self.pr)
        for field, key, value in [
            ("head", "sha", "b" * 40), ("head", "repo", {"full_name": "other/fork"}),
            ("base", "ref", "test"), ("base", "repo", {"full_name": "other/repo"}),
        ]:
            self.pr = copy.deepcopy(original)
            self.pr[field][key] = value
            with self.subTest(field=field, key=key), self.assertRaises(gate.Blocked):
                self.check()
    def test_merged_pr_requires_its_merge_commit_on_main(self):
        self.pr["state"] = "closed"
        self.pr["merged"] = True
        self.pr["merge_commit_sha"] = "c" * 40
        comparison = {"status": "ahead", "behind_by": 0,
                      "base_commit": {"sha": "c" * 40}}
        self.assertEqual(self.check_merged(comparison), SHA)
        for invalid in [None,
                        {"status": "behind", "behind_by": 1,
                         "base_commit": {"sha": "c" * 40}},
                        {"status": "ahead", "behind_by": 0,
                         "base_commit": {"sha": "d" * 40}}]:
            with self.subTest(comparison=invalid), self.assertRaises(gate.Blocked):
                self.check_merged(invalid)

    def test_closed_unmerged_pr_blocks(self):
        self.pr["state"] = "closed"
        self.pr["merged"] = False
        with self.assertRaises(gate.Blocked):
            self.check()

    def test_missing_or_unassociated_ci_blocks(self):
        self.runs[0]["pull_requests"] = []
        with self.assertRaises(gate.Blocked):
            self.check()

    def test_failed_pending_cancelled_or_skipped_ci_blocks(self):
        for status, conclusion in [
            ("in_progress", None), ("completed", "failure"),
            ("completed", "cancelled"), ("completed", "skipped"),
        ]:
            self.runs[0].update(status=status, conclusion=conclusion)
            with self.subTest(status=status, conclusion=conclusion), \
                    self.assertRaises(gate.Blocked):
                self.check()

    def test_latest_run_blocks_or_supersedes_old_failure(self):
        latest = dict(self.runs[0], id=999, run_number=2, conclusion="failure")
        self.runs.append(latest)
        with self.assertRaises(gate.Blocked):
            self.check()
        latest.update(conclusion="success")
        self.runs[0]["conclusion"] = "failure"
        self.assertEqual(self.check(), SHA)

    def test_incomplete_api_listing_blocks(self):
        with self.assertRaises(gate.Blocked):
            gate.check_candidate(self.pr, {"total_count": 999,
                "workflow_runs": self.runs}, 42, SHA)

    def test_optional_matching_workflow_failure_blocks(self):
        self.runs.append(dict(self.runs[0], id=999,
            path=".github/workflows/chat-v20-browser.yml", conclusion="failure"))
        with self.assertRaises(gate.Blocked):
            self.check()
