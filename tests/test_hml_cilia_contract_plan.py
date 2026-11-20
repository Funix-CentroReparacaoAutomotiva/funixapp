"""Pure Cilia HML configuration planner tests; no live services."""
import copy
import importlib.util
from pathlib import Path
import unittest


DEPLOY = Path(__file__).resolve().parents[1] / "deploy"
spec = importlib.util.spec_from_file_location("hml_cilia_plan", DEPLOY / "hml-cilia-plan.py")
plan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plan)
REV = "5" * 40


def baseline():
    return {"name": "funix-hml", "services": {
        "api": {"image": "api@sha256:old", "environment": {"FUNIX_REVISION": REV,
                                                         "FUNIX_OPERATOR_PASSWORD": "opaque"}},
        "web": {"image": "web@sha256:old", "environment": {}},
        "gateway": {"image": "gateway@sha256:fixed", "environment": {}},
    }}


class PureContractPlanTests(unittest.TestCase):
    def test_legacy_off_to_preview_with_exact_new_digest(self):
        original = baseline()
        prior = copy.deepcopy(original)
        tx = plan.plan(original, plan.PREVIEW_ONLY, plan.digest(original), REV)
        self.assertEqual(original, prior, "planner must not mutate input")
        self.assertEqual(tx["from"], plan.OFF)
        self.assertEqual(tx["new_api_flags"][plan.PREVIEW], "true")
        self.assertEqual(tx["new_api_flags"][plan.WRITE], "false")
        self.assertNotEqual(tx["old_contract_sha256"], tx["new_contract_sha256"])
        self.assertTrue(plan.verify_applied(tx, original, plan.desired_compose(original, tx["to"])))

    def test_reverse_preview_to_off(self):
        original = baseline()
        original["services"]["api"]["environment"].update({
            plan.PREVIEW: "true", plan.WRITE: "false"})
        tx = plan.plan(original, plan.OFF, plan.digest(original), REV)
        self.assertEqual(tx["from"], plan.PREVIEW_ONLY)
        self.assertEqual(tx["to"], plan.OFF)
        self.assertTrue(plan.verify_applied(tx, tx["normalized_compose"]))

    def test_write_on_is_never_allowed(self):
        original = baseline()
        original["services"]["api"]["environment"][plan.WRITE] = "true"
        with self.assertRaisesRegex(ValueError, "write must remain disabled"):
            plan.plan(original, plan.PREVIEW_ONLY, plan.digest(original), REV)

    def test_unknown_mode_and_invalid_values_rejected(self):
        original = baseline()
        for value in ("TRUE", 1, "yes", ""):
            variant = copy.deepcopy(original)
            variant["services"]["api"]["environment"][plan.PREVIEW] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "invalid preview"):
                plan.plan(variant, plan.PREVIEW_ONLY, plan.digest(variant), REV)
        with self.assertRaisesRegex(ValueError, "unsupported target"):
            plan.plan(original, "WRITE", plan.digest(original), REV)

    def test_flags_disallowed_on_other_roles(self):
        for role in ("web", "gateway"):
            variant = baseline()
            variant["services"][role]["environment"][plan.PREVIEW] = "true"
            with self.subTest(role=role), self.assertRaisesRegex(ValueError, "outside API"):
                plan.plan(variant, plan.PREVIEW_ONLY, plan.digest(variant), REV)

    def test_noop_and_revision_mismatch_rejected(self):
        source = baseline()
        with self.assertRaisesRegex(ValueError, "no-op"):
            plan.plan(source, plan.OFF, plan.digest(source), REV)
        with self.assertRaisesRegex(ValueError, "revision differs"):
            plan.plan(source, plan.PREVIEW_ONLY, plan.digest(source), "6" * 40)

    def test_stale_contract_rejected(self):
        source = baseline()
        with self.assertRaisesRegex(ValueError, "contract digest differs"):
            plan.plan(source, plan.PREVIEW_ONLY, "0" * 64, REV)

    def test_verify_applied_rejects_unrelated_changes(self):
        source = baseline()
        tx = plan.plan(source, plan.PREVIEW_ONLY, plan.digest(source), REV)
        changed = plan.desired_compose(source, tx["to"])
        changed["services"]["web"]["environment"]["WEBHOOK_URL"] = "https://example.invalid"
        with self.assertRaisesRegex(ValueError, "normalized Compose mismatch"):
            plan.verify_applied(tx, source, changed)

    def test_pin_remains_sensitive_to_write_flag_even_when_preview_allowed(self):
        source = baseline()
        tx = plan.plan(source, plan.PREVIEW_ONLY, plan.digest(source), REV)
        changed = copy.deepcopy(tx["normalized_compose"])
        changed["services"]["api"]["environment"][plan.WRITE] = "true"
        self.assertNotEqual(plan.digest(changed), tx["new_contract_sha256"])
        with self.assertRaises(ValueError):
            plan.verify_applied(tx, changed)


if __name__ == "__main__":
    unittest.main()
