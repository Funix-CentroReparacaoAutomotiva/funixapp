"""Tests for the sanitized, read-only Traefik diagnostic."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "hml_traefik_readonly", ROOT / "deploy/hml-traefik-readonly.py"
)
assert SPEC and SPEC.loader
DIAGNOSTIC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DIAGNOSTIC)


class HmlTraefikReadonlyTests(unittest.TestCase):
    def test_static_projection_allows_only_relevant_keys_and_hashes_sensitive_values(self):
        inspected = {
            "Args": ["--providers.docker.watch=true", "--providers.docker.constraints=Label(`scope`,`secret-prod`)",
                     "--api.dashboard=true"],
            "Config": {"Env": ["TRAEFIK_PROVIDERS_DOCKER_EXPOSEDBYDEFAULT=false",
                                  "UNRELATED_SECRET=do-not-print"]},
        }
        result = DIAGNOSTIC.static_projection(inspected)
        rendered = json.dumps(result)
        self.assertEqual(result["providers.docker.watch"], "true")
        self.assertEqual(result["providers.docker.exposedbydefault"], "false")
        self.assertNotIn("secret-prod", rendered)
        self.assertNotIn("UNRELATED_SECRET", rendered)

    def test_compose_projection_redacts_basic_auth_and_keeps_routing_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "gateway.compose.yaml"
            path.write_text("""services:\n  gateway:\n    networks: [funix-hml_privada, traefik_default]\n    labels:\n      - traefik.enable=true\n      - traefik.http.routers.funix-hml.rule=Host(`hml.funix.com.br`)\n      - traefik.http.middlewares.auth.basicauth.users=user:secret\n      - traefik.http.services.funix-hml.loadbalancer.server.port=8080\n""", encoding="utf-8")
            result = DIAGNOSTIC.compose_projection(path)
        rendered = json.dumps(result)
        self.assertIn("hml.funix.com.br", rendered)
        self.assertIn("8080", rendered)
        self.assertNotIn("user:secret", rendered)
        self.assertTrue(result["mentions_private_network"])
        self.assertTrue(result["mentions_traefik_network"])

    def test_logs_emit_categories_counts_and_hashes_without_raw_message(self):
        raw = ("2026-11-16T00:00:00Z level=error msg=\"Unable to obtain ACME certificate "
               "for secret.example\"\n"
               "secret.example level=error msg=\"Docker provider failed\"\n")
        result = DIAGNOSTIC.log_projection(raw)
        rendered = json.dumps(result)
        self.assertEqual(result["counts"]["acme"], 1)
        self.assertNotIn("secret.example", rendered)
        self.assertNotIn("Unable", rendered)
        self.assertIsNone(result["events"][1]["time"])

    def test_collect_uses_only_read_only_docker_commands_and_requires_absent_gateway(self):
        inspect = [{"Image": "sha256:x", "Args": [], "Config": {"Env": []},
                    "State": {"Running": True, "StartedAt": "now"}, "Mounts": [],
                    "NetworkSettings": {"Networks": {"traefik_default": {}}}}]
        with tempfile.TemporaryDirectory() as directory:
            compose = Path(directory) / "gateway.yaml"
            compose.write_text("services:\n  gateway:\n    networks: [traefik_default]\n", encoding="utf-8")
            args = DIAGNOSTIC.parser().parse_args([
                "--since", "2026-11-16T00:00:00Z", "--until", "2026-11-16T00:10:00Z",
                "--gateway-compose", str(compose),
            ])
            outputs = [None, json.dumps(inspect), "[{}]", ""]
            with patch.object(DIAGNOSTIC, "run", side_effect=outputs) as run:
                result = DIAGNOSTIC.collect(args)
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual([command[1:3] for command in commands[:3]],
                         [["container", "inspect"], ["container", "inspect"], ["network", "inspect"]])
        self.assertEqual(commands[3][1], "logs")
        self.assertTrue(result["gateway_absent"])


if __name__ == "__main__":
    unittest.main()
