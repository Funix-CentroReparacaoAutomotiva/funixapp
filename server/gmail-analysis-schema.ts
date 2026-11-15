import type {DatabaseSync} from 'node:sqlite'
import {hasGmailIntakeSchema} from './gmail-intake-schema.ts'
import {hasUpdatePackageSchema} from './update-packages-schema.ts'
export function hasGmailAnalysisSchema(db:DatabaseSync){return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE name='gmail_analysis_jobs'").get())}
/** Opt-in additive module migration; no alteration of historical migrations or records. */
export function createGmailAnalysisSchema(db:DatabaseSync){
 if(!hasGmailIntakeSchema(db)||!hasUpdatePackageSchema(db))throw Error('GMAIL_ANALYSIS_REQUIRES_EXISTING_STORAGE')
 db.exec('BEGIN IMMEDIATE')
 try{
  db.exec(`CREATE TABLE IF NOT EXISTS gmail_analysis_pilot_scope(
   singleton INTEGER PRIMARY KEY CHECK(singleton=1),notice_id TEXT NOT NULL REFERENCES gmail_intake_notices(id),
   activated_at TEXT NOT NULL,account_id TEXT NOT NULL,configuration_hash TEXT NOT NULL,scope_hash TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS gmail_analysis_pilot_immutable BEFORE UPDATE ON gmail_analysis_pilot_scope
   BEGIN SELECT RAISE(ABORT,'Gmail pilot scope immutable'); END;
  CREATE TRIGGER IF NOT EXISTS gmail_analysis_pilot_no_delete BEFORE DELETE ON gmail_analysis_pilot_scope
   BEGIN SELECT RAISE(ABORT,'Gmail pilot scope immutable'); END;
  CREATE TABLE IF NOT EXISTS gmail_analysis_jobs(
   notice_id TEXT PRIMARY KEY REFERENCES gmail_intake_notices(id) ON DELETE RESTRICT,
   authorized_revision INTEGER NOT NULL,authorized_hash TEXT NOT NULL,
   state TEXT NOT NULL CHECK(state IN ('queued','processing','ready','needs_information','failed')),
   generation INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,
   lease_token TEXT,lease_expires_at TEXT,next_attempt_at TEXT,error_code TEXT,
   extraction_json TEXT CHECK(extraction_json IS NULL OR json_valid(extraction_json)),
   package_id TEXT REFERENCES update_packages(id),prior_package_id TEXT REFERENCES update_packages(id),
   created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
   CHECK((state='processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (state!='processing' AND lease_token IS NULL AND lease_expires_at IS NULL))
  );
  CREATE INDEX IF NOT EXISTS gmail_analysis_due ON gmail_analysis_jobs(state,next_attempt_at,lease_expires_at);
  CREATE TABLE IF NOT EXISTS gmail_analysis_proposals(
   package_id TEXT PRIMARY KEY REFERENCES update_packages(id) ON DELETE RESTRICT,
   notice_id TEXT NOT NULL REFERENCES gmail_analysis_jobs(notice_id),generation INTEGER NOT NULL,
   result_json TEXT NOT NULL CHECK(json_valid(result_json)),result_hash TEXT NOT NULL,
   UNIQUE(notice_id,generation)
  );
  CREATE TRIGGER IF NOT EXISTS gmail_analysis_result_immutable BEFORE UPDATE ON gmail_analysis_proposals
   BEGIN SELECT RAISE(ABORT,'Gmail analysis snapshot immutable'); END;
  CREATE TABLE IF NOT EXISTS gmail_analysis_commands(
   notice_id TEXT NOT NULL REFERENCES gmail_analysis_jobs(notice_id),request_id TEXT NOT NULL,
   payload_hash TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(notice_id,request_id)
  );`)
  db.exec('COMMIT')
 }catch(error){db.exec('ROLLBACK');throw error}
}
