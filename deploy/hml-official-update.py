#!/usr/bin/env python3
"""One locally authorized HML operation using the existing official updater."""
import argparse
import importlib.util
import json
import re
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("updater", Path(__file__).with_name("hml-update.py"))
updater = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(updater)


def coordinate(operation_id, identity, *, authorize_operation, authorize_revision):
    if (not re.fullmatch(r"op-[A-Za-z0-9_-]{1,80}", operation_id)
            or authorize_operation != operation_id
            or not re.fullmatch(r"[a-f0-9]{40}", identity.get("revision", ""))
            or authorize_revision != identity["revision"]):
        raise ValueError("exact operation and revision authorization required")
    if any(type(identity.get(key)) is not int or identity[key] <= 0
           for key in ("artifact_id", "run_id", "attempt", "pr")):
        raise ValueError("invalid artifact identity")
    operation = updater.STATE / operation_id
    config_path = operation / "config.json"
    report = {"operation": operation_id, "candidate_revision": identity["revision"],
              "artifact": {key: identity[key] for key in ("artifact_id", "run_id", "attempt", "pr")},
              "previous_revision": None, "completed": [], "result": "rejected",
              "journal": "absent", "recovery": "not_required", "next_action": "review_failure"}
    scoped = False
    try:
        updater.host_scope(operation, config_path)
        scoped = True
        report["completed"].append("scope")
        if (operation / "operation.json").exists() or config_path.exists():
            report.update(journal="existing", next_action="inspect_existing_operation")
            return report
        # Official lock protects this read-only pending check. Update reacquires
        # the same lock and rechecks everything before loading/mutating services.
        transaction_module = updater.load("hml-update-transaction")
        guard = transaction_module.Transaction(operation, None, project_state=updater.STATE)
        with guard.locked():
            active = updater.STATE / "active.json"
            if active.exists():
                pointer = json.loads(updater.root_file(active).read_text())
                journal = Path(pointer["journal"])
                if journal.parent.parent != updater.STATE:
                    raise ValueError("invalid pending journal")
                phase = json.loads(updater.root_file(journal).read_text())["phase"]
                if phase not in ("accepted", "restored"):
                    report.update(result="pending_recovery", journal="pending", recovery="required", next_action="authorized_recover")
                    return report
            updater.prepare_operation(operation, config_path, identity)
            report["completed"].append("prepared")
            config = json.loads(updater.root_file(config_path).read_text())
            updater.check_config(config, operation)
            previous = updater.installed_preflight(updater.make_adapter(config))
            report["previous_revision"] = previous["revision"]
            report["completed"].append("preflight")
        updater.execute_operation("update", config, operation, authorized=True)
        report["completed"].append("update")
    except Exception:
        # Never render exception messages, expanded config, credentials or logs.
        pass
    if scoped and (operation / "operation.json").exists():
        try:
            journal = json.loads(updater.root_file(operation / "operation.json").read_text())
            phase = journal["phase"]
            report["journal"] = phase if phase in ("accepted", "restored") else "pending"
            previous = journal["previous"]["revision"]
            report["previous_revision"] = previous if re.fullmatch(r"[a-f0-9]{40}", previous) else None
            if phase == "accepted":
                report.update(result="accepted", next_action="functional_review")
            elif phase == "restored":
                report.update(result="rejected_restored", recovery="completed", next_action="review_failure")
            else:
                report.update(result="pending_recovery", recovery="required", next_action="authorized_recover")
        except Exception:
            report.update(result="pending_recovery", journal="unreadable", recovery="required",
                          next_action="inspect_private_journal")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--revision", required=True)
    for name in ("artifact-id", "run-id", "attempt", "pr"):
        parser.add_argument("--" + name, type=int, required=True)
    parser.add_argument("--authorize-operation", required=True)
    parser.add_argument("--authorize-revision", required=True)
    args = parser.parse_args()
    identity = {key: getattr(args, key) for key in ("artifact_id", "run_id", "attempt", "pr", "revision")}
    try:
        result = coordinate(args.operation, identity, authorize_operation=args.authorize_operation,
                            authorize_revision=args.authorize_revision)
    except Exception:
        print(json.dumps({"result": "rejected", "next_action": "review_authorization"}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0 if result["result"] == "accepted" else 1


if __name__ == "__main__":
    raise SystemExit(main())
