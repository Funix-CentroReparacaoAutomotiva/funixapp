"""Regression tests for the optional HML Cilia Compose overlay.

No Docker or HML host access. Exercises the exact production adapter's
argument construction with private synthetic files.
"""
import importlib.util
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("hml_docker_adapter_overlay", ROOT / "hml-docker-adapter.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
spec_store = importlib.util.spec_from_file_location("hml_cilia_store_overlay", ROOT / "hml-cilia-contract-store.py")
store = importlib.util.module_from_spec(spec_store)
spec_store.loader.exec_module(store)


class CiliaOverlayAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.images = self.state / "images.json"
        self.cilia = self.state / "cilia-flags.json"
        self.fake = object.__new__(adapter.DockerAdapter)
        self.fake.state = self.state
        self.fake.override = self.images
        self.fake.base = ["docker", "compose", "--project-name", "funix-hml", "-f", "/synthetic/compose.yaml"]

    def test_original_flags_unset_uses_original_args(self):
        self.assertEqual(self.fake.release_args(), self.fake.base)

    def test_exact_overlay_is_ordered_after_images(self):
        self.images.write_text('{"services": {"api": {"image": "synthetic"}}}')
        self.cilia.write_bytes(store.override_bytes(True))
        self.assertEqual(self.fake.release_args(),
                         self.fake.base + ["-f", str(self.images), "-f", str(self.cilia)])

    def test_unrelated_or_write_enabled_override_fails_closed(self):
        for body in (
            '{"services":{"api":{"environment":{"FUNIX_CILIA_PREVIEW_ENABLED":"true","FUNIX_CILIA_WRITE_ENABLED":"true"}}}}',
            '{"services":{"web":{"environment":{"FUNIX_CILIA_PREVIEW_ENABLED":"true","FUNIX_CILIA_WRITE_ENABLED":"false"}}}}',
            '{"services":{"api":{"environment":{"FUNIX_CILIA_PREVIEW_ENABLED":"true","FUNIX_CILIA_WRITE_ENABLED":"false","SECRET":"oops"}}}}',
        ):
            with self.subTest(body=body):
                self.cilia.write_text(body)
                with self.assertRaises(ValueError):
                    self.fake.release_args()

    def test_overlay_symlink_is_rejected(self):
        target = self.state / "external"
        target.write_bytes(store.override_bytes(True))
        self.cilia.symlink_to(target)
        with self.assertRaises(ValueError):
            self.fake.release_args()

    def test_missing_override_does_not_demand_new_file(self):
        self.images.write_text('{}')
        self.assertEqual(self.fake.release_args(), self.fake.base + ["-f", str(self.images)])


if __name__ == "__main__":
    unittest.main()
