"""Pure, side-effect-free contract planning for the HML Cilia preview gate.

This module intentionally does not mutate Compose files, the pinned digest, Docker,
the gateway, or the database. A privileged transaction controller must apply a
reviewed plan under the existing global HML lock and perform durable recovery.
"""
import copy
import importlib.util
from pathlib import Path


PREVIEW = "FUNIX_CILIA_PREVIEW_ENABLED"
WRITE = "FUNIX_CILIA_WRITE_ENABLED"
OFF = "OFF"
PREVIEW_ONLY = "PREVIEW_ONLY"


def _load_adapter():
    path = Path(__file__).with_name("hml-docker-adapter.py")
    spec = importlib.util.spec_from_file_location("hml_docker_adapter_for_cilia", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(config):
    return _load_adapter().contract_digest(config)


def _require(condition, message):
    if not condition:
        raise ValueError("Cilia HML plan: " + message)


def _api_environment(config):
    _require(isinstance(config, dict) and config.get("name") == "funix-hml", "unexpected project")
    services = config.get("services")
    _require(isinstance(services, dict) and set(services) == {"api", "web", "gateway"},
             "unexpected service set")
    env = services["api"].get("environment")
    _require(isinstance(env, dict), "missing API environment")
    return env


def mode(config):
    """Return OFF or PREVIEW_ONLY, rejecting any write-enabled or invalid state.

    OFF intentionally includes the legacy UNSET state; desired ON is literal
    'true', exactly as required by the application.
    """
    env = _api_environment(config)
    read = env.get(PREVIEW)
    write = env.get(WRITE)
    _require(read in (None, "false", "0", "true"), "invalid preview value")
    _require(write in (None, "false", "0"), "write must remain disabled")
    for role in ("web", "gateway"):
        role_env = config["services"][role].get("environment") or {}
        _require(PREVIEW not in role_env and WRITE not in role_env,
                 "Cilia flags prohibited outside API")
    return PREVIEW_ONLY if read == "true" else OFF


def desired_compose(current, target):
    """Build expected candidate in memory; NEVER write it to a journal or logs."""
    _require(target in (OFF, PREVIEW_ONLY), "unsupported target")
    _require(mode(current) != target, "no-op transition refused")
    candidate = copy.deepcopy(current)
    candidate["services"]["api"]["environment"].update({
        PREVIEW: "true" if target == PREVIEW_ONLY else "false", WRITE: "false"})
    _require(mode(candidate) == target, "target state differs")
    return candidate


def plan(current, target, expected_digest, expected_revision):
    """Return redacted transition metadata; retain full Compose only in memory.

    Current configuration must be freshly observed under the global HML lock.
    Neither flag is removed from either pinned digest. A privileged controller
    must atomically change configuration, lock/backup, validate, and recover.
    """
    _require(isinstance(expected_digest, str) and len(expected_digest) == 64
             and all(c in "0123456789abcdef" for c in expected_digest),
             "invalid expected digest")
    _require(isinstance(expected_revision, str) and len(expected_revision) == 40
             and all(c in "0123456789abcdef" for c in expected_revision),
             "invalid revision")
    _require(digest(current) == expected_digest, "current contract digest differs")
    _require(_api_environment(current).get("FUNIX_REVISION") == expected_revision,
             "API revision differs")
    previous = mode(current)
    candidate = desired_compose(current, target)
    return {
        "schema": "funix-hml-cilia-plan/1",
        "scope": "funix-hml",
        "revision": expected_revision,
        "from": previous,
        "to": target,
        "old_contract_sha256": expected_digest,
        "new_contract_sha256": digest(candidate),
        "new_api_flags": {PREVIEW: "true" if target == PREVIEW_ONLY else "false",
                          WRITE: "false"},
    }


def verify_applied(plan_record, original, observed):
    """Reject unrelated changes without persisting secret-bearing Compose."""
    _require(isinstance(plan_record, dict)
             and set(plan_record) == {"schema", "scope", "revision", "from", "to",
                                     "old_contract_sha256", "new_contract_sha256",
                                     "new_api_flags"}
             and plan_record.get("schema") == "funix-hml-cilia-plan/1"
             and plan_record.get("scope") == "funix-hml", "invalid plan")
    _require(digest(original) == plan_record["old_contract_sha256"],
             "original contract differs")
    _require(mode(original) == plan_record["from"], "source mode differs")
    expected = desired_compose(original, plan_record["to"])
    _require(plan_record["new_api_flags"] == {
        PREVIEW: "true" if plan_record["to"] == PREVIEW_ONLY else "false",
        WRITE: "false"}, "flag plan differs")
    _require(observed == expected, "normalized Compose mismatch")
    _require(digest(observed) == plan_record["new_contract_sha256"],
             "new contract digest differs")
    _require(_api_environment(observed).get("FUNIX_REVISION") == plan_record["revision"],
             "revision differs")
    return True
