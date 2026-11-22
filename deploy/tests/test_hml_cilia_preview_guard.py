"""Regression checks for the Cilia preview-only HML isolation exception.

These tests do not access Docker, networks, databases or live HML systems.
"""
import copy
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
REVISION = "a" * 40


def load(name):
    path = ROOT / (name + ".py")
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


isolation = load("hml-isolation")
adapter = load("hml-docker-adapter")


def api_environment():
    return {
        **isolation.FIXED,
        "FUNIX_REVISION": REVISION,
        "FUNIX_OPERATOR_PASSWORD": "a" * 24,
        **{flag: "false" for flag in isolation.FLAGS},
    }


class HmlCiliaPreviewGuardTests(unittest.TestCase):
    def test_unset_preview_write_keeps_current_default(self):
        isolation.environment("api", api_environment(), REVISION)

    def test_preview_only_is_allowed(self):
        env = api_environment()
        env["FUNIX_CILIA_PREVIEW_ENABLED"] = "true"
        env["FUNIX_CILIA_WRITE_ENABLED"] = "false"
        self.assertEqual(isolation.environment("api", env, REVISION), env)

    def test_cilia_compose_and_runtime_presence_must_match(self):
        for flag in (isolation.CILIA_PREVIEW, isolation.CILIA_WRITE):
            with self.subTest(flag=flag):
                # The original release has neither flag in either layer.
                isolation.cilia_runtime_parity({}, {})
                with self.assertRaisesRegex(ValueError, "runtime flag differs"):
                    isolation.cilia_runtime_parity({flag: "true"}, {})
                with self.assertRaisesRegex(ValueError, "runtime flag differs"):
                    isolation.cilia_runtime_parity({}, {flag: "true"})
                with self.assertRaisesRegex(ValueError, "runtime flag differs"):
                    isolation.cilia_runtime_parity({flag: "false"}, {flag: "true"})
                isolation.cilia_runtime_parity({flag: "false"}, {flag: "false"})

    def test_explicit_write_true_rejected_with_preview_on_or_off(self):
        for preview in ("true", "false"):
            with self.subTest(preview=preview):
                env = api_environment()
                env["FUNIX_CILIA_PREVIEW_ENABLED"] = preview
                env["FUNIX_CILIA_WRITE_ENABLED"] = "true"
                with self.assertRaises(ValueError):
                    isolation.environment("api", env, REVISION)

    def test_preview_true_not_allowed_on_web_or_gateway(self):
        for role in ("web", "gateway"):
            with self.subTest(role=role):
                with self.assertRaises(ValueError):
                    isolation.environment(role, {"FUNIX_CILIA_PREVIEW_ENABLED": "true"}, REVISION)

    def test_unknown_and_external_flags_still_rejected(self):
        for name in ("FUNIX_WHATSAPP_INGEST_ENABLED", "FUNIX_EVOLUTION_READ_ENABLED",
                     "FUNIX_UNKNOWN_ENABLED", "FUNIX_UNKNOWN_ENABLE"):
            with self.subTest(name=name):
                env = api_environment()
                env["FUNIX_CILIA_PREVIEW_ENABLED"] = "true"
                env[name] = "true"
                with self.assertRaises(ValueError):
                    isolation.environment("api", env, REVISION)

    def test_preview_cannot_smuggle_external_configuration(self):
        for name in ("WEBHOOK_URL", "FUNIX_CILIA_TOKEN", "FUNIX_CILIA_ENDPOINT"):
            with self.subTest(name=name):
                env = api_environment()
                env["FUNIX_CILIA_PREVIEW_ENABLED"] = "true"
                env[name] = "example"
                with self.assertRaises(ValueError):
                    isolation.environment("api", env, REVISION)

    def test_invalid_preview_literals_rejected(self):
        for value in ("TRUE", "1", "yes", "enabled"):
            with self.subTest(value=value):
                env = api_environment()
                env["FUNIX_CILIA_PREVIEW_ENABLED"] = value
                with self.assertRaises(ValueError):
                    isolation.environment("api", env, REVISION)

    def test_duplicate_environment_keys_rejected(self):
        env = [f"{k}={v}" for k, v in api_environment().items()]
        env += ["FUNIX_CILIA_PREVIEW_ENABLED=false", "FUNIX_CILIA_PREVIEW_ENABLED=true"]
        with self.assertRaises(ValueError):
            isolation.environment("api", env, REVISION)

    def test_contract_digest_still_pins_cilia_flags(self):
        original = {"name": "funix-hml", "services": {
            "api": {"image": "api:old", "environment": {
                "FUNIX_REVISION": REVISION,
                "FUNIX_CILIA_PREVIEW_ENABLED": "false",
                "FUNIX_CILIA_WRITE_ENABLED": "false",
            }},
            "web": {"image": "web:old"},
            "gateway": {"image": "gateway:fixed"},
        }}
        changed = copy.deepcopy(original)
        changed["services"]["api"]["environment"]["FUNIX_CILIA_PREVIEW_ENABLED"] = "true"
        self.assertNotEqual(adapter.contract_digest(original), adapter.contract_digest(changed))
        changed["services"]["api"]["environment"]["FUNIX_CILIA_WRITE_ENABLED"] = "true"
        self.assertNotEqual(adapter.contract_digest(original), adapter.contract_digest(changed))

    def test_adapter_preflight_rejects_write_and_other_integrations(self):
        """Exercise flag gate before container inspection using an inert adapter double."""
        fake = object.__new__(adapter.DockerAdapter)
        fake.check_release = lambda candidate: None
        fake.assert_contract = lambda: config
        fake.database = Path("/tmp/nonexistent-cilia-hml-db")
        fake.state = Path("/tmp")
        for key in ("FUNIX_CILIA_WRITE_ENABLED", "FUNIX_WHATSAPP_INGEST_ENABLED"):
            config = {"services": {
                "api": {"environment": {key: "true"}, "read_only": True,
                        "networks": {"private": {}}, "volumes": []},
                "web": {"read_only": True, "networks": {"private": {}}, "volumes": []},
                "gateway": {"read_only": True, "networks": {"private": {}, "edge": {}}, "volumes": []},
            }, "networks": {"private": {"name": "funix-hml_privada"},
                            "edge": {"name": "traefik_default"}}}
            with self.subTest(key=key):
                with self.assertRaisesRegex(ValueError, "external integration flag enabled"):
                    fake.preflight({})

    def test_adapter_accepts_preview_flag_until_actual_docker_checks(self):
        fake = object.__new__(adapter.DockerAdapter)
        fake.check_release = lambda candidate: None
        fake.assert_contract = lambda: config
        fake.database = Path("/tmp/nonexistent-cilia-hml-db")
        fake.state = Path("/tmp")
        config = {"services": {
            "api": {"environment": {"FUNIX_CILIA_PREVIEW_ENABLED": "true",
                                    "FUNIX_CILIA_WRITE_ENABLED": "false"},
                    "read_only": True, "networks": {"private": {}}, "volumes": []},
            "web": {"read_only": True, "networks": {"private": {}}, "volumes": []},
            "gateway": {"read_only": True, "networks": {"private": {}, "edge": {}}, "volumes": []},
        }, "networks": {"private": {"name": "funix-hml_privada"},
                        "edge": {"name": "traefik_default"}}}
        def reached_containers():
            raise RuntimeError("reached Docker inspection")
        fake.containers = reached_containers
        with self.assertRaisesRegex(RuntimeError, "reached Docker inspection"):
            fake.preflight({})


if __name__ == "__main__":
    unittest.main()
