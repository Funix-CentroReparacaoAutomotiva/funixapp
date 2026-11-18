import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "guard", Path(__file__).resolve().parents[1] / "hml-writer-guard.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class WriterGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name) / "data"
        self.data.mkdir()
        self.db = self.data / "funix.sqlite"
        self.db.write_bytes(b"synthetic" * 512)
        self.proc = Path("/proc") / str(os.getpid())

    def test_overlapping_mounts(self):
        for source in (self.data, self.data.parent, self.db, self.data / "child"):
            self.assertTrue(guard.overlaps(source, self.data))
        self.assertFalse(guard.overlaps(self.data.parent / "production", self.data))

    def test_no_open_handles(self):
        guard.scan_process(self.proc, self.data, guard.identities(self.data))

    def test_external_process_handle(self):
        command = "import sys; f=open(sys.argv[1],'rb'); print('ready',flush=True); sys.stdin.read()"
        p = subprocess.Popen([sys.executable, "-c", command, str(self.db)],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(p.stdout.readline().strip(), "ready")
            with self.assertRaisesRegex(guard.WriterGuardError, "handle"):
                guard.scan_process(Path("/proc") / str(p.pid), self.data,
                                   guard.identities(self.data))
        finally:
            p.terminate()
            p.wait(timeout=5)
            p.stdin.close()
            p.stdout.close()

    def test_mapped_database_after_descriptor_closed(self):
        # Python mmap may retain an internal fd: synthetic maps also cover
        # mmap-only identities independently of the descriptor check.
        synthetic = self.data.parent / "proc"
        synthetic.mkdir()
        (synthetic / "fd").mkdir()
        major, minor, inode = next(iter(guard.identities(self.data)))
        (synthetic / "maps").write_text(
            f"1000-2000 rw-s 00000000 {major:x}:{minor:x} {inode} /data/alias\n")
        with self.assertRaisesRegex(guard.WriterGuardError, "mapping"):
            guard.scan_process(synthetic, self.data, guard.identities(self.data))

    def test_incomplete_process_inspection_blocks(self):
        synthetic = self.data.parent / "proc"
        synthetic.mkdir()
        with self.assertRaisesRegex(guard.WriterGuardError, "incomplete"):
            guard.scan_process(synthetic, self.data, guard.identities(self.data))

    def test_sidecar_and_nonregular_blocks(self):
        wal = Path(str(self.db) + "-wal")
        wal.write_bytes(b"wal")
        with wal.open("rb"), self.assertRaisesRegex(guard.WriterGuardError, "handle"):
            guard.scan_process(self.proc, self.data, guard.identities(self.data))
        wal.unlink()
        wal.symlink_to(self.db)
        with self.assertRaises(guard.WriterGuardError):
            guard.identities(self.data)

    def test_nonroot_full_scan_blocks(self):
        with patch.object(guard.os, "geteuid", return_value=1000):
            with self.assertRaisesRegex(guard.WriterGuardError, "root"):
                guard.assert_quiescent(self.data)
