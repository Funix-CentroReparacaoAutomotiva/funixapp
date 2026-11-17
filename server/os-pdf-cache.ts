import type {DatabaseSync} from 'node:sqlite'
import {validatePdf} from './jsreport-client.ts'

const TEMPLATE_VERSION='v1-jsreport-1'
/** Immutable PDF per OS. Never caches a cancellation watermark on the original. */
export class WorkOrderPdfCache{
 private readonly db:DatabaseSync
 constructor(db:DatabaseSync){
   this.db=db
   // Separate opt-in storage: do not alter the FUNIX schema_migrations contract.
   db.exec(`
     CREATE TABLE IF NOT EXISTS work_order_pdf_cache (
       work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
       template_version TEXT NOT NULL,
       pdf BLOB NOT NULL CHECK(length(pdf)>16),
       created_at TEXT NOT NULL,
       PRIMARY KEY(work_order_id,template_version)
     );
     CREATE TRIGGER IF NOT EXISTS immutable_work_order_pdf_cache_update BEFORE UPDATE ON work_order_pdf_cache
       BEGIN SELECT RAISE(ABORT,'Work order PDF cache is immutable'); END;
     CREATE TRIGGER IF NOT EXISTS immutable_work_order_pdf_cache_delete BEFORE DELETE ON work_order_pdf_cache
       BEGIN SELECT RAISE(ABORT,'Work order PDF cache is immutable'); END;
   `)
 }
 get(orderId:string):Buffer|null{
   const row=this.db.prepare('SELECT pdf FROM work_order_pdf_cache WHERE work_order_id=? AND template_version=?')
     .get(orderId,TEMPLATE_VERSION)
   return row?Buffer.from(row.pdf as Uint8Array):null
 }
 save(orderId:string,pdf:Buffer):Buffer{
   validatePdf(pdf)
   // In concurrent requests, first committed renderer wins and is reused.
   this.db.prepare('INSERT OR IGNORE INTO work_order_pdf_cache(work_order_id,template_version,pdf,created_at) VALUES(?,?,?,?)')
     .run(orderId,TEMPLATE_VERSION,pdf,new Date().toISOString())
   return this.get(orderId)??pdf
 }
}
