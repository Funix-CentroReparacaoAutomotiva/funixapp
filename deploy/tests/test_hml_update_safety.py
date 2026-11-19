import copy
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import io
import tarfile
import hashlib

spec = importlib.util.spec_from_file_location(
    "hml_update_safety", Path(__file__).resolve().parents[1] / "hml-update-safety.py")
assert spec and spec.loader
safety = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safety)
REV = "a" * 40


class CandidateTest(unittest.TestCase):
    def test_archive_binds_config_ids_and_rejects_productive_tag(self):
        for bad in (False, True):
            records = []
            with tarfile.open(self.archive, "w:gz") as bundle:
                def add(name, content):
                    item = tarfile.TarInfo(name)
                    item.size = len(content)
                    bundle.addfile(item, io.BytesIO(content))
                for role in ("api", "web"):
                    config = json.dumps({"config": {"Labels": {
                        "org.opencontainers.image.revision": REV}}, "role": role}).encode()
                    digest = hashlib.sha256(config).hexdigest()
                    self.data["images"][role]["image_id"] = "sha256:" + digest
                    add(digest + ".json", config)
                    add(role + "/layer.tar", b"synthetic")
                    records.append({"Config": digest + ".json", "Layers": [role + "/layer.tar"],
                                    "RepoTags": ["funixapp:latest" if bad else f"funix-hml-{role}:{REV}"]})
                add("manifest.json", json.dumps(records).encode())
            if bad:
                with self.assertRaises(safety.Blocked):
                    safety.verify_image_archive(self.archive, self.data)
            else:
                self.assertTrue(safety.verify_image_archive(self.archive, self.data))

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.archive = self.root / "images.tar.gz"
        self.archive.write_bytes(b"synthetic archive bytes")
        self.data = {
            "schema": 1, "purpose": "hml-candidate-only", "revision": REV,
            "pr": 262, "run_id": "123", "run_attempt": "1",
            "archive_sha256": safety.sha256(self.archive),
            "images": {
                "api": {"tag": f"funix-hml-api:{REV}", "image_id": "sha256:" + "1" * 64},
                "web": {"tag": f"funix-hml-web:{REV}", "image_id": "sha256:" + "2" * 64},
            },
        }

    def verify(self, **overrides):
        (self.root / "manifest.json").write_text(json.dumps(self.data))
        args = dict(revision=REV, pr=262, run_id="123", run_attempt="1")
        args.update(overrides)
        return safety.verify_candidate(self.root, **args)

    def test_accept_and_bind_candidate(self):
        self.assertEqual(self.verify(), self.data)
        for changes in ({"revision": "b" * 40}, {"pr": 1}, {"run_id": "124"},
                        {"run_attempt": "2"}):
            with self.subTest(changes=changes), self.assertRaises(safety.Blocked):
                self.verify(**changes)

    def test_corrupt_archive_blocks(self):
        self.archive.write_bytes(b"changed")
        with self.assertRaises(safety.Blocked):
            self.verify()

    def test_production_tags_and_extra_images_block(self):
        saved = copy.deepcopy(self.data)
        self.data["images"]["api"]["tag"] = "funixapp-api:latest"
        with self.assertRaises(safety.Blocked):
            self.verify()
        self.data = saved
        self.data["images"]["other"] = self.data["images"]["api"]
        with self.assertRaises(safety.Blocked):
            self.verify()

    def test_symlink_blocks(self):
        outside = self.root.parent / (self.root.name + "-outside")
        outside.write_bytes(self.archive.read_bytes())
        self.addCleanup(outside.unlink)
        self.archive.unlink()
        self.archive.symlink_to(outside)
        with self.assertRaises(safety.Blocked):
            self.verify()


class RecoveryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "source.sqlite"
        self.backup = self.root / "backup.sqlite"
        self.restore = self.root / "restore.sqlite"
        self.db = sqlite3.connect(self.source)
        self.addCleanup(self.db.close)
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA wal_autocheckpoint=0;
            CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
            INSERT INTO schema_migrations VALUES(1);
            CREATE TABLE atendimentos(id INTEGER PRIMARY KEY, name TEXT);
            INSERT INTO atendimentos VALUES(1,'synthetic');
            CREATE TABLE scenarios(id INTEGER PRIMARY KEY);
            CREATE TABLE budget_versions(id INTEGER PRIMARY KEY);
        """)
        self.db.commit()

    def test_wal_snapshot_and_recovery_after_synthetic_migration(self):
        self.assertTrue(Path(str(self.source) + "-wal").exists())
        digest = safety.snapshot(self.source, self.backup)
        self.assertEqual(self.backup.stat().st_mode & 0o777, 0o600)
        self.db.executescript("""
            ALTER TABLE atendimentos ADD COLUMN changed TEXT;
            DELETE FROM atendimentos;
            INSERT INTO schema_migrations VALUES(2);
        """)
        self.db.commit()
        self.assertEqual(safety.stage_restore(
            self.backup, self.restore, expected_sha256=digest), digest)
        with sqlite3.connect(self.restore) as recovered:
            self.assertEqual(recovered.execute(
                "SELECT * FROM atendimentos").fetchall(), [(1, "synthetic")])
            self.assertEqual(recovered.execute(
                "SELECT version FROM schema_migrations").fetchall(), [(1,)])
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM atendimentos").fetchone(), (0,))
        self.assertEqual(safety.sha256(self.backup), digest)

    def test_existing_destination_not_overwritten(self):
        self.backup.write_bytes(b"preserve")
        with self.assertRaises(FileExistsError):
            safety.snapshot(self.source, self.backup)
        self.assertEqual(self.backup.read_bytes(), b"preserve")

    def test_restore_rejects_corruption_and_existing_target(self):
        digest = safety.snapshot(self.source, self.backup)
        with self.assertRaises(FileExistsError):
            safety.stage_restore(self.backup, self.source, expected_sha256=digest)
        with self.assertRaises(safety.Blocked):
            safety.stage_restore(self.backup, self.restore, expected_sha256="0" * 64)
        self.assertFalse(self.restore.exists())

    def test_restore_rejects_sidecars(self):
        digest = safety.snapshot(self.source, self.backup)
        Path(str(self.backup) + "-wal").write_bytes(b"unexpected")
        with self.assertRaises(safety.Blocked):
            safety.stage_restore(self.backup, self.restore, expected_sha256=digest)
        self.assertFalse(self.restore.exists())

    def test_invalid_migration_history_blocks_backup(self):
        self.db.execute("INSERT INTO schema_migrations VALUES(3)")
        self.db.commit()
        with self.assertRaises(safety.Blocked):
            safety.snapshot(self.source, self.backup)
        self.assertFalse(self.backup.exists())
