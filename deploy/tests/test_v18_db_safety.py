"""V18 migration preflight regression tests; exclusively synthetic disposable SQLite."""
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/"v18-db-safety.py"
class V18SafetyTests(unittest.TestCase):
 def setUp(self):
  temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
  self.root=Path(temp.name);self.db=self.root/"app.sqlite"
  self.folder=self.root/"backups";self.folder.mkdir(mode=0o700)
  self.backup=self.folder/"before.sqlite"
  with sqlite3.connect(self.db) as db:
   db.executescript("""PRAGMA journal_mode=WAL;
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
    CREATE TABLE atendimentos(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE scenarios(id TEXT PRIMARY KEY,atendimento_id TEXT REFERENCES atendimentos(id));
    CREATE TABLE budget_versions(id TEXT PRIMARY KEY);
    CREATE TABLE budget_document_identity(id TEXT PRIMARY KEY);""")
   db.executemany("INSERT INTO schema_migrations VALUES(?)",[(v,) for v in range(1,18)])
   db.execute("INSERT INTO atendimentos VALUES('a1','Cliente sintético')")
 def run_script(self,cmd,src=None,dst=None):
  argv=[sys.executable,str(SCRIPT),cmd,str(src or self.db)]
  if cmd!="inspect":argv.append(str(dst or self.backup))
  return subprocess.run(argv,capture_output=True,text=True)
 def test_inspection_backup_recovery(self):
  self.assertEqual(self.run_script("inspect").returncode,0)
  first=self.run_script("backup");self.assertEqual(first.returncode,0,first.stderr)
  self.assertEqual(self.backup.stat().st_mode&0o777,0o600)
  target=self.folder/"restore.sqlite";second=self.run_script("rehearse",self.backup,target)
  self.assertEqual(second.returncode,0,second.stderr)
  self.assertEqual(first.stdout.split("sha256=")[-1],second.stdout.split("sha256=")[-1])
  with sqlite3.connect(target) as db:
   self.assertEqual(db.execute("SELECT name FROM atendimentos").fetchone(),("Cliente sintético",))
 def test_includes_committed_wal(self):
  db=sqlite3.connect(self.db);self.addCleanup(db.close)
  db.execute("PRAGMA journal_mode=WAL")
  db.execute("INSERT INTO atendimentos VALUES('a2','Sintético WAL')");db.commit()
  self.assertEqual(self.run_script("backup").returncode,0)
  with sqlite3.connect(self.backup) as copy:
   self.assertEqual(copy.execute("SELECT COUNT(*) FROM atendimentos").fetchone(),(2,))
 def test_does_not_overwrite(self):
  self.backup.write_text("PRESERVE")
  self.assertNotEqual(self.run_script("backup").returncode,0)
  self.assertEqual(self.backup.read_text(),"PRESERVE")
 def test_rejects_future_version(self):
  with sqlite3.connect(self.db) as db:db.execute("INSERT INTO schema_migrations VALUES(18)")
  self.assertNotEqual(self.run_script("inspect").returncode,0)
  self.assertNotEqual(self.run_script("backup").returncode,0)
  self.assertFalse(self.backup.exists())
 def test_rejects_incomplete_history(self):
  with sqlite3.connect(self.db) as db:db.execute("DELETE FROM schema_migrations WHERE version=10")
  self.assertNotEqual(self.run_script("inspect").returncode,0)
 def test_rejects_symlinks_and_invalid_files(self):
  link=self.root/"alias.sqlite";link.symlink_to(self.db)
  self.assertNotEqual(self.run_script("backup",link).returncode,0)
  invalid=self.root/"not-sqlite";invalid.write_text("INVALID")
  self.assertNotEqual(self.run_script("inspect",invalid).returncode,0)
 def test_rejects_insecure_backup_directory(self):
  self.folder.chmod(0o777)
  self.assertNotEqual(self.run_script("backup").returncode,0)
 def test_rehearsal_preserves_existing(self):
  first=self.run_script("backup");self.assertEqual(first.returncode,0,first.stderr)
  destination=self.folder/"restore.sqlite";destination.write_text("KEEP")
  self.assertNotEqual(self.run_script("rehearse",self.backup,destination).returncode,0)
  self.assertEqual(destination.read_text(),"KEEP")

if __name__=="__main__":
 unittest.main()
