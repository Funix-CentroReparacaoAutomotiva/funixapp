#!/usr/bin/env python3
"""One locally authorized HML operation using the existing official updater."""
import argparse
import importlib.util
import json
import re
import sys
import os
import tempfile
from contextlib import redirect_stdout, redirect_stderr, contextmanager
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("updater", Path(__file__).with_name("hml-update.py"))
updater = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(updater)

PHASES = {"prepared", "quiescing", "installing", "rollback_requested", "restoring",
          "accepted_pending_open", "restored_pending_open", "accepted", "restored"}


def read_journal(path):
    if (path.name != "operation.json" or path.parent.parent != updater.STATE
            or not re.fullmatch(r"op-[A-Za-z0-9_-]{1,80}", path.parent.name)):
        raise ValueError("invalid journal target")
    record = json.loads(updater.root_file(path).read_text())
    if (type(record.get("schema")) is not int or record["schema"] != 1
            or record.get("project") != "funix-hml" or record.get("phase") not in PHASES):
        raise ValueError("invalid journal contract")
    return record


def pending_status(report):
    """Caller holds the official lock; never recommend an unverified target."""
    report.update(recovery="unknown", recovery_operation=None)
    active = updater.STATE / "active.json"
    if active.exists() or active.is_symlink():
        pointer = json.loads(updater.root_file(active).read_text())
        if set(pointer) != {"journal"}:
            raise ValueError("invalid active pointer")
        path = Path(pointer["journal"])
        record = read_journal(path)
        if record["phase"] not in ("accepted", "restored"):
            report.update(result="pending_recovery", journal="pending", recovery="required",
                          recovery_operation=path.parent.name, next_action="authorized_recover")
            return True
    report["recovery"] = "not_required"
    return False


@contextmanager
def sanitized_output():
    """Capture Python and inherited subprocess descriptors; emit only safe HTTPS categories."""
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as captured:
        sys.stdout.flush()
        sys.stderr.flush()
        saved = [os.dup(1), os.dup(2)]
        try:
            os.dup2(captured.fileno(), 1)
            os.dup2(captured.fileno(), 2)
            with redirect_stdout(captured), redirect_stderr(captured):
                yield
        finally:
            captured.flush()
            for descriptor, original in zip((1, 2), saved):
                os.dup2(original, descriptor)
                os.close(original)
            captured.seek(0)
            for line in captured:
                if re.fullmatch(r"HTTPS attempt=[1-3] category=(?:tls-security|transient|contract) retry=(?:true|false)\n?", line):
                    sys.stderr.write(line)


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
              "journal": "unknown", "recovery": "unknown", "recovery_operation": None,
              "next_action": "review_failure"}
    scoped = False
    execution_started = False
    try:
        updater.host_scope(operation, config_path)
        scoped = True
        report["completed"].append("scope")
        # Official lock protects this read-only pending check. Update reacquires
        # the same lock and rechecks everything before loading/mutating services.
        transaction_module = updater.load("hml-update-transaction")
        guard = transaction_module.Transaction(operation, None, project_state=updater.STATE)
        with guard.locked():
            if pending_status(report):
                return report
            if (operation / "operation.json").exists() or config_path.exists():
                report.update(journal="existing", recovery="unknown", next_action="inspect_existing_operation")
                return report
            report["journal"] = "absent"
            updater.prepare_operation(operation, config_path, identity)
            report["completed"].append("prepared")
            config = json.loads(updater.root_file(config_path).read_text())
            updater.check_config(config, operation)
            previous = updater.installed_preflight(updater.make_adapter(config))
            report["previous_revision"] = previous["revision"]
            report["completed"].append("preflight")
        execution_started = True
        updater.execute_operation("update", config, operation, authorized=True)
        report["completed"].append("update")
    except Exception:
        # Never render exception messages, expanded config, credentials or logs.
        pass
    if scoped:
        try:
            with guard.locked():
                if pending_status(report):
                    return report
                if execution_started and (operation / "operation.json").exists():
                    journal = read_journal(operation / "operation.json")
                    phase = journal["phase"]
                    report["journal"] = phase
                    previous = journal["previous"]["revision"]
                    report["previous_revision"] = previous if re.fullmatch(r"[a-f0-9]{40}", previous) else None
                    if phase == "accepted":
                        report.update(result="accepted", next_action="functional_review")
                    elif phase == "restored":
                        report.update(result="rejected_restored", recovery="completed", next_action="review_failure")
                    else:
                        # A pending local journal not identified by the active
                        # pointer cannot safely be passed to official recover.
                        report.update(result="inspection_required", journal="pending", recovery="unknown",
                                      recovery_operation=None, next_action="administrative_inspection")
        except BlockingIOError:
            report.update(result="busy", journal="unknown", recovery="unknown", recovery_operation=None,
                          next_action="inspect_when_idle")
        except Exception:
            report.update(result="inspection_required", journal="unreadable", recovery="unknown",
                          recovery_operation=None, next_action="administrative_inspection")
    return report


def main():
    class SafeParser(argparse.ArgumentParser):
        def error(self, message):
            print(json.dumps({"result": "rejected", "next_action": "review_arguments"}))
            raise SystemExit(2)
    parser = SafeParser(description=__doc__)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--revision", required=True)
    for name in ("artifact-id", "run-id", "attempt", "pr"):
        parser.add_argument("--" + name, type=int, required=True)
    parser.add_argument("--authorize-operation", required=True)
    parser.add_argument("--authorize-revision", required=True)
    args = parser.parse_args()
    identity = {key: getattr(args, key) for key in ("artifact_id", "run_id", "attempt", "pr", "revision")}
    try:
        with sanitized_output():
            result = coordinate(args.operation, identity, authorize_operation=args.authorize_operation,
                                authorize_revision=args.authorize_revision)
    except Exception:
        print(json.dumps({"result": "rejected", "next_action": "review_authorization"}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0 if result["result"] == "accepted" else 1


if __name__ == "__main__":
    raise SystemExit(main())
