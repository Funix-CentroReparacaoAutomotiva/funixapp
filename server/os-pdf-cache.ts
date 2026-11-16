import type {DatabaseSync} from 'node:sqlite'
import {validatePdf} from './jsreport-client.ts'

const TEMPLATE_VERSION='v63-jsreport-1'
/** Immutable PDF per OS. Never caches a cancellation watermark on the original. */
export class WorkOrderPdfCache{
 constructor(private readonly db:DatabaseSync){}
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
