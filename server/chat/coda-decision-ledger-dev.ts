import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { DevelopmentCodaOutbox } from './coda-outbox-dev.ts'
import type { DevelopmentSourceLedger } from './coda-source-storage-dev.ts'
import type { RecoverableCodaRow } from './coda-recovery-dev.ts'
import type { ConfirmedCodaEvent } from './coda-sync.ts'

/**
 * DEV-only append-only message->canonical Coda row decisions.
 * The classifier must confirm the decision AFTER reading Coda, never guess
 * the target from phone. No producer, route or timer enabled by this module.
 */
export type ConfirmedWhatsAppDecision = {
  eventId: string
  codaRowId: string
  remoteJid: string
}
const eventPattern=/^evo:funix_comercial:[A-Za-z0-9:_-]{1,128}$/
const rowPattern=/^i-[A-Za-z0-9_-]{1,100}$/
const jidPattern=/^[0-9]{8,15}@s\.whatsapp\.net$/
const channelId='i-O01Tgl0bN2'
export function createDevelopmentDecisionLedgerSchema(db:DatabaseSync) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS dev_whatsapp_confirmed_decisions (',
    ' event_id TEXT PRIMARY KEY, coda_row_id TEXT NOT NULL,',
    ' remote_jid TEXT NOT NULL, digest TEXT NOT NULL, confirmed_at INTEGER NOT NULL);'
  ].join('\n'))
}
export class DevelopmentDecisionLedger {
  private readonly db:DatabaseSync
  constructor(db:DatabaseSync){this.db=db}
  append(value:ConfirmedWhatsAppDecision, nowMs:number):'created'|'existing' {
    if(!value || typeof value!=='object' || Array.isArray(value) ||
       Object.keys(value).length!==3 || !eventPattern.test(value.eventId) ||
       !rowPattern.test(value.codaRowId) || !jidPattern.test(value.remoteJid) ||
       !Number.isSafeInteger(nowMs) || nowMs<0) throw Error('DECISION_INVALID')
    const digest=createHash('sha256').update(JSON.stringify(value)).digest('hex')
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const existing=this.db.prepare('SELECT digest FROM dev_whatsapp_confirmed_decisions WHERE event_id=?')
        .get(value.eventId) as {digest:string}|undefined
      if(existing){
        if(existing.digest!==digest)throw Error('DECISION_CONFLICT')
        this.db.exec('COMMIT')
        return 'existing'
      }
      this.db.prepare('INSERT INTO dev_whatsapp_confirmed_decisions VALUES(?,?,?,?,?)')
        .run(value.eventId,value.codaRowId,value.remoteJid,digest,nowMs)
      this.db.exec('COMMIT')
      return 'created'
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  readAll(limit=10000):ConfirmedWhatsAppDecision[]{
    if(!Number.isInteger(limit)||limit<1||limit>10000)throw Error('DECISION_SCAN_LIMIT')
    const rows=this.db.prepare('SELECT event_id,coda_row_id,remote_jid,digest FROM dev_whatsapp_confirmed_decisions ORDER BY event_id LIMIT ?')
      .all(limit+1) as Array<{event_id:string,coda_row_id:string,remote_jid:string,digest:string}>
    if(rows.length>limit)throw Error('DECISION_SCAN_LIMIT')
    return rows.map(r=>{
      const data={eventId:r.event_id,codaRowId:r.coda_row_id,remoteJid:r.remote_jid}
      const digest=createHash('sha256').update(JSON.stringify(data)).digest('hex')
      if(digest!==r.digest)throw Error('DECISION_LEDGER_CORRUPT')
      return data
    })
  }
}
export function reconcileConfirmedDecisions(
  outbox:DevelopmentCodaOutbox,
  sourceLedger:DevelopmentSourceLedger,
  decisionLedger:DevelopmentDecisionLedger,
  confirmedRows:readonly RecoverableCodaRow[],
  nowMs:number,
) {
  // Fail closed on incomplete source scan or duplicates before queuing anything.
  const sources=new Map<string,ReturnType<DevelopmentSourceLedger['readPage']>['entries'][number]>()
  let cursor=''
  for(;;) {
    const page=sourceLedger.readPage(cursor,100)
    for(const s of page.entries){
      if(sources.has(s.eventId))throw Error('SOURCE_DUPLICATE')
      sources.set(s.eventId,s)
      if(sources.size>10000)throw Error('SOURCE_SCAN_LIMIT')
    }
    if(page.nextCursor===null)break
    if(page.nextCursor<=cursor)throw Error('SOURCE_INVALID_CURSOR')
    cursor=page.nextCursor
  }
  const decisions=decisionLedger.readAll()
  const rowCount=new Map<string,number>()
  const canonical=new Map<string,RecoverableCodaRow>()
  for(const row of confirmedRows){
    if(!row || typeof row.id!=='string')continue
    rowCount.set(row.id,(rowCount.get(row.id)??0)+1)
    canonical.set(row.id,row)
  }
  let queued=0,existing=0,review=0,missingSource=0
  const staged:ConfirmedCodaEvent[]=[]
  for(const decision of decisions){
    const src=sources.get(decision.eventId)
    if(!src){missingSource++;continue}
    const row=canonical.get(decision.codaRowId)
    const channel=typeof row?.funil_Canal==='object' && row?.funil_Canal!==null
      ? (row.funil_Canal as {rowId?:unknown}).rowId : row?.funil_Canal
    const origin=typeof row?.fx_UUID==='string'?row.fx_UUID.trim():''
    if(!row || rowCount.get(row.id)!==1 ||
       !eventPattern.test(origin) ||
       channel!==channelId ||
       row['api_ID Omnichanel']!==src.remoteJid ||
       src.remoteJid!==decision.remoteJid ||
       src.suppressed!==false ||
       (typeof row.funil_contatoE164==='string' && row.funil_contatoE164!=='' &&
        row.funil_contatoE164!==src.phoneE164)) {review++;continue}
    staged.push({
      version:1,source:'coda',eventId:src.eventId,codaRowId:row.id,
      instance:'funix_comercial',remoteJid:src.remoteJid,
      phoneE164:src.phoneE164,displayName:src.displayName,
      occurredAt:src.occurredAt,
    })
  }
  // Reject any conflicting message claims before first queue write.
  const claims=new Map<string,string>()
  for(const event of staged){
    const old=claims.get(event.eventId)
    if(old&&old!==event.codaRowId)throw Error('DECISION_DUPLICATE_CLAIM')
    claims.set(event.eventId,event.codaRowId)
  }
  for(const event of staged){
    try {
      const state=outbox.enqueue(event,'whatsapp',event.codaRowId,nowMs)
      if(state==='created')queued++
      else existing++
    } catch {review++}
  }
  return {queued,existing,review,missingSource}
}
