import hashlib
import gzip
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import subprocess

SPEC = importlib.util.spec_from_file_location("identity", Path(__file__).resolve().parents[1] / "hml-image-identity.py")
identity = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(identity)


class ImageIdentityTests(unittest.TestCase):
    def fixture(self, path, *, corrupt_layer=False, compressed=False, tags=True):
        layer = b"synthetic layer bytes"
        config = json.dumps({"architecture": "amd64", "os": "linux", "config": {
            "Labels": {"org.opencontainers.image.revision": "a" * 40}},
            "rootfs": {"type": "layers", "diff_ids": ["sha256:" + hashlib.sha256(layer).hexdigest()]}}).encode()
        digest = "sha256:" + hashlib.sha256(config).hexdigest()
        with tarfile.open(path, "w") as archive:
            for name, content in {
                "manifest.json": json.dumps([{"RepoTags": ["funix-hml-api:test"] if tags else None,
                    "Config": "config.json", "Layers": ["layer.tar"]}]).encode(),
                "config.json": config, "layer.tar": b"tampered" if corrupt_layer else gzip.compress(layer) if compressed else layer,
            }.items():
                member = tarfile.TarInfo(name)
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
        return digest

    def test_equivalent_content_accepts_classic_and_containerd_display_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "fixture.tar"
            expected = self.fixture(archive, tags=False)
            for displayed in (expected, "sha256:" + "b" * 64):
                def command(args, **kwargs):
                    if "save" in args:
                        self.assertEqual(args[-1], displayed)
                        Path(args[args.index("--output") + 1]).write_bytes(archive.read_bytes())
                        return subprocess.CompletedProcess(args, 0)
                    return subprocess.CompletedProcess(args, 0, json.dumps([{"Id": displayed}]).encode())
                with patch.object(identity.subprocess, "run", side_effect=command):
                    self.assertEqual(identity.verify_local_image("funix-hml-api:test", expected,
                                     directory=directory), displayed)

    def test_tag_reassignment_cannot_change_returned_verified_id(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "fixture.tar"
            expected = self.fixture(archive, tags=False)
            original_id = "sha256:" + "b" * 64
            calls = []
            def command(args, **kwargs):
                calls.append(args)
                if "inspect" in args:
                    if len(calls) != 1:
                        self.fail("mutable tag inspected again after export")
                    return subprocess.CompletedProcess(args, 0, json.dumps([{"Id": original_id}]).encode())
                # Tag now points elsewhere. Export must still select immutable original ID.
                self.assertEqual(args[-1], original_id)
                Path(args[args.index("--output") + 1]).write_bytes(archive.read_bytes())
                return subprocess.CompletedProcess(args, 0)
            with patch.object(identity.subprocess, "run", side_effect=command):
                self.assertEqual(identity.verify_local_image("funix-hml-api:test", expected,
                                 directory=directory), original_id)
            self.assertEqual(len(calls), 2)

    def test_rejects_wrong_config_even_with_matching_revision_label(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "fixture.tar"
            self.fixture(archive)
            with self.assertRaisesRegex(ValueError, "configuration digest"):
                identity.verify_saved_image(archive, tag="funix-hml-api:test", config_digest="sha256:" + "b" * 64)

    def test_compressed_layer_is_bound_to_uncompressed_diff_id(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "fixture.tar"
            expected = self.fixture(archive, compressed=True)
            identity.verify_saved_image(archive, tag="funix-hml-api:test", config_digest=expected)

    def test_rejects_tampered_layer_with_unchanged_config(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "fixture.tar"
            expected = self.fixture(archive, corrupt_layer=True)
            with self.assertRaisesRegex(ValueError, "layer digest"):
                identity.verify_saved_image(archive, tag="funix-hml-api:test", config_digest=expected)
