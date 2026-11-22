"""Cilia-only HML Docker transaction adapter, intentionally without a CLI.

Requires an independently authorized coordinator holding the same global lock
as the official updater. Reuses its maintenance gateway and validators. Never
changes the application images, releases, web service, DB schema, or production.
This module alone is NOT permission to change a live HML configuration.
"""
import importlib.util
from pathlib import Path


def load(name):
    spec = importlib.util.spec_from_file_location(
        "cilia_" + name.replace("-", "_"), Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


planner = load("hml-cilia-plan")
store_module = load("hml-cilia-contract-store")
safety = load("hml-update-safety")


def require(condition, reason):
    if not condition:
        raise ValueError("HML Cilia Docker adapter: " + reason)


class CiliaDockerAdapter:
    """Transactional adapter for one pinned HML revision.

    The supplied 'docker' must be the reviewed MaintenanceDockerAdapter
    from hml-docker-maintenance.py. No Docker daemon or arbitrary filesystem
    path is accepted here; privileged host_scope is owned by the future
    external authorized operator and MUST be checked before constructing us.
    """

    def __init__(self, docker, state, operation):
        self.state = store_module.canonical_directory(state)
        self.operation = store_module.canonical_directory(operation)
        require(self.operation.parent == self.state
                and self.operation.name.startswith("op-cilia-"),
                "operation outside updater state")
        require(docker.state == self.state, "Docker adapter state differs")
        for hook in ("configuration", "preflight", "containers", "normal_mounts",
                     "enter_maintenance", "gate_args", "assert_gateway_mounts",
                     "check_live_isolation", "validate", "open_access", "run"):
            require(callable(getattr(docker, hook, None)), "maintenance adapter incomplete")
        self.docker = docker
        self.docker.operation_directory = self.operation
        self.files = store_module.Store(self.state, self.operation)
        self.release = None
        self.original = None

    def observe(self):
        # Effective Compose: base + images + validated optional Cilia override.
        return self.docker.configuration()

    def _current_release(self, rendered):
        records = self.docker.containers()
        require(len(records) == 3, "HML must have exactly three containers")
        images = {}
        for item in records:
            role = (item.get("Config", {}).get("Labels") or {}).get(
                "com.docker.compose.service")
            require(role in ("api", "web", "gateway") and role not in images,
                    "unexpected HML container")
            images[role] = item["Image"]
        require(set(images) == {"api", "web", "gateway"},
                "incomplete live HML")
        images["revision"] = rendered["services"]["api"]["environment"]["FUNIX_REVISION"]
        return images

    def assert_safe(self, before, revision):
        require(self.observe() == before, "Compose changed during preflight")
        require(before["services"]["api"]["environment"].get("FUNIX_REVISION") == revision,
                "unexpected API revision")
        pinned, flags = self.files.observe()
        require(planner.digest(before) == pinned, "pinned contract differs")
        # Never proceed from a write-enabled or otherwise invalid flag state.
        planner.mode(before)
        candidate = self._current_release(before)
        require(candidate["revision"] == revision, "installed revision differs")
        actual = self.docker.preflight(candidate)
        require(actual == candidate, "installed HML differs")
        self.original = before
        self.release = candidate

    def backup(self, before, plan):
        require(before == self.original and self.release is not None,
                "preflight was not established")
        require(planner.digest(before) == plan["old_contract_sha256"],
                "old contract differs")
        # Preserve the database in a consistent standalone snapshot without
        # restoring it automatically: a config-only rollback must not discard
        # legitimate data committed after the transition.
        digest = safety.snapshot(self.docker.database, self.operation / "cilia-db-backup.sqlite")
        require(safety.sha256(self.operation / "cilia-db-backup.sqlite") == digest,
                "database snapshot checksum differs")
        return self.files.prepare(plan["old_contract_sha256"])

    def enter_maintenance(self):
        # This method reuses the existing gateway gate configuration and HTTP
        # restrictions. The public gateway is stopped BEFORE any flag change.
        self.docker.enter_maintenance()
        self.docker.run(self.docker.gate_args() + [
            "up", "--detach", "--no-build", "--pull", "never",
            "--no-deps", "--force-recreate", "gateway"])
        self.docker.assert_gateway_mounts(restricted=True)

    def switch_to(self, plan, backup_ref):
        require(self.release is not None and self.original is not None,
                "preflight was not established")
        self.docker.assert_gateway_mounts(restricted=True)
        self.files.stage_override(backup_ref, plan["old_contract_sha256"],
                                  plan["to"] == planner.PREVIEW_ONLY)
        # Must be actual 'docker compose config', not planner's anticipated
        # output. The only allowed delta is the two Cilia environment flags.
        actual = self.observe()
        self.files.commit_pin(backup_ref, plan, self.original, actual)
        self.docker.contract = plan["new_contract_sha256"]
        self.docker.run(self.docker.gate_args() + [
            "up", "--detach", "--no-build", "--pull", "never",
            "--no-deps", "--force-recreate", "api"])
        self.docker.assert_gateway_mounts(restricted=True)

    def validate(self, plan):
        pinned, overlay = self.files.observe()
        require(pinned == plan["new_contract_sha256"],
                "installed contract pin differs")
        require(planner.mode(self.observe()) == plan["to"],
                "installed Cilia mode differs")
        require(planner.digest(self.observe()) == pinned,
                "rendered Compose differs from accepted pin")
        # The live isolation check rejects runtime-only Cilia flags, changed
        # volumes, extra services, unexpected networks and image mismatches.
        if self.release is None:
            self.release = self._current_release(self.observe())
        require(self.release["revision"] == plan["revision"],
                "live revision differs")
        self.docker.check_live_isolation(self.release, restricted=True)
        self.docker.validate(self.release)

    def restore(self, plan, backup_ref):
        self.docker.assert_gateway_mounts(restricted=True)
        self.files.restore(backup_ref, plan["old_contract_sha256"],
                           plan["new_contract_sha256"],
                           plan["to"] == planner.PREVIEW_ONLY)
        self.docker.contract = plan["old_contract_sha256"]
        self.docker.run(self.docker.gate_args() + [
            "up", "--detach", "--no-build", "--pull", "never",
            "--no-deps", "--force-recreate", "api"])
        self.docker.assert_gateway_mounts(restricted=True)

    def open_access(self, plan):
        self.validate(plan)
        self.docker.open_access(self.release)
