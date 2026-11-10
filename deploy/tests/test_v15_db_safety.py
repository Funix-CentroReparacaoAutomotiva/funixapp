"""Unit tests use only temporary SQLite files; no VPS or production."""
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
SCRIPT=Path(__file__).resolve().parents[1]/"v15-db-safety.py"
class V15SafetyTests(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.addCleanup(self.t.cleanup)
  self.root=Path(self.t.name);self.db=self.root/"app.sqlite";self.dir=self.root/"backups";self.dir.mkdir(mode=0o700);self.backup=self.dir/"before.sqlite"
  conn=sqlite3.connect(self.db)
  conn.executescript("PRAGMA journal_mode=WAL; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); CREATE TABLE atendimentos(id TEXT PRIMARY KEY,name TEXT); CREATE TABLE scenarios(id TEXT PRIMARY KEY,atendimento_id TEXT REFERENCES atendimentos(id)); CREATE TABLE budget_versions(id TEXT PRIMARY KEY);")
  conn.executemany("INSERT INTO schema_migrations VALUES(?)",[(v,) for v in range(1,15)])
  conn.execute("INSERT INTO atendimentos VALUES('a1','Sintético')");conn.execute("INSERT INTO scenarios VALUES('s1','a1')");conn.commit();conn.close()
 def run_script(self,action,src=None,dst=None):
  return subprocess.run([sys.executable,str(SCRIPT),action,str(src or self.db),str(dst or self.backup)],capture_output=True,text=True)
 def test_backup_and_restoration_copy(self):
  first=self.run_script("backup");self.assertEqual(first.returncode,0,first.stderr)
  self.assertEqual(self.backup.stat().st_mode&0o777,0o600)
  restored=self.dir/"restore.sqlite";second=self.run_script("rehearse",self.backup,restored)
  self.assertEqual(second.returncode,0,second.stderr)
  self.assertEqual(first.stdout.split("sha256=")[-1],second.stdout.split("sha256=")[-1])
  with sqlite3.connect(restored) as db:self.assertEqual(db.execute("SELECT name FROM atendimentos").fetchone(),("Sintético",))
 def test_uncheckpointed_committed_wal(self):
  conn=sqlite3.connect(self.db);self.addCleanup(conn.close);conn.execute("PRAGMA journal_mode=WAL")
  conn.execute("INSERT INTO atendimentos VALUES('a2','Em WAL')");conn.commit()
  self.assertEqual(self.run_script("backup").returncode,0)
  with sqlite3.connect(self.backup) as db:self.assertEqual(db.execute("SELECT COUNT(*) FROM atendimentos").fetchone(),(2,))
 def test_existing_backup_not_overwritten(self):
  self.backup.write_text("KEEP");self.assertNotEqual(self.run_script("backup").returncode,0);self.assertEqual(self.backup.read_text(),"KEEP")
 def test_bad_version_rejected(self):
  with sqlite3.connect(self.db) as db:db.execute("DELETE FROM schema_migrations WHERE version=14")
  self.assertNotEqual(self.run_script("backup").returncode,0);self.assertFalse(self.backup.exists())
 def test_symlink_rejected(self):
  link=self.root/"alias.sqlite";link.symlink_to(self.db);self.assertNotEqual(self.run_script("backup",link).returncode,0)
 def test_insecure_destination_rejected(self):
  self.dir.chmod(0o777);self.assertNotEqual(self.run_script("backup").returncode,0)
 def test_invalid_sqlite_rejected(self):
  bad=self.root/"bad.sqlite";bad.write_text("BAD");self.assertNotEqual(self.run_script("backup",bad).returncode,0)
 def test_rehearsal_does_not_overwrite(self):
  self.assertEqual(self.run_script("backup").returncode,0)
  dst=self.dir/"restore.sqlite";dst.write_text("KEEP")
  self.assertNotEqual(self.run_script("rehearse",self.backup,dst).returncode,0);self.assertEqual(dst.read_text(),"KEEP")
