"""Pure, side-effect-free contract planning for the HML Cilia preview gate.

This module intentionally does not mutate Compose files, the pinned digest, Docker,
the gateway, or the database. A privileged transaction controller must apply a
reviewed plan under the existing global HML lock and perform durable recovery.
"""
import copy
import hashlib
import importlib.util
import json
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


def plan(current, target, expected_digest, expected_revision):
    """Propose the exact normalized Compose delta and both pinned digests.

    No I/O. Does not strip Cilia flags from the contract digest. Caller must
    compare the result to a fresh observed Compose and verify the live HML
    revision, health, lock/journal, before writing anything.
    """
    _require(target in (OFF, PREVIEW_ONLY), "unsupported target")
    _require(isinstance(expected_digest, str) and len(expected_digest) == 64
             and all(c in "0123456789abcdef" for c in expected_digest),
             "invalid expected digest")
    _require(isinstance(expected_revision, str) and len(expected_revision) == 40
             and all(c in "0123456789abcdef" for c in expected_revision),
             "invalid revision")
    before = copy.deepcopy(current)
    _require(digest(before) == expected_digest, "current contract digest differs")
    _require(before["services"]["api"]["environment"].get("FUNIX_REVISION") == expected_revision,
             "API revision differs")
    source_mode = mode(before)
    _require(source_mode != target, "no-op transition refused")
    after = copy.deepcopy(before)
    after_env = after["services"]["api"]["environment"]
    after_env[PREVIEW] = "true" if target == PREVIEW_ONLY else "false"
    after_env[WRITE] = "false"
    _require(mode(after) == target, "target state differs")
    for key in (PREVIEW, WRITE):
        after_env.pop(key)
    pre_reconstructed = copy.deepcopy(before)
    # Verify that the only edited path is the two explicit Cilia flags.
    # Do not drop the flags from the digests, which MUST remain distinct.
    pre_reconstructed["services"]["api"]["environment"].pop(PREVIEW, None)
    pre_reconstructed["services"]["api"]["environment"].pop(WRITE, None)
    _require(pre_reconstructed == after, "unexpected mutation")
    after = copy.deepcopy(before)
    after["services"]["api"]["environment"].update({
        PREVIEW: "true" if target == PREVIEW_ONLY else "false", WRITE: "false"})
    return {
        "schema": "funix-hml-cilia-plan/1",
        "scope": "funix-hml",
        "revision": expected_revision,
        "from": source_mode,
        "to": target,
        "old_contract_sha256": expected_digest,
        "new_contract_sha256": digest(after),
        "new_api_flags": {PREVIEW: after["services"]["api"]["environment"][PREVIEW],
                          WRITE: "false"},
        "normalized_compose": after,
    }


def verify_applied(plan_record, observed):
    """Reject arbitrary changes, live/prepared revision drift and altered pins."""
    _require(isinstance(plan_record, dict)
             and plan_record.get("schema") == "funix-hml-cilia-plan/1"
             and plan_record.get("scope") == "funix-hml", "invalid plan")
    expected = plan_record.get("normalized_compose")
    _require(isinstance(expected, dict) and observed == expected,
             "normalized Compose mismatch")
    _require(digest(observed) == plan_record.get("new_contract_sha256"),
             "new contract digest differs")
    _require(observed["services"]["api"]["environment"].get("FUNIX_REVISION")
             == plan_record.get("revision"), "revision differs")
    _require(mode(observed) == plan_record.get("to"), "flag state differs")
    return True
