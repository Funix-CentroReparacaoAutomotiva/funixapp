/** Offline, read-only evidence. Never opens the application, migrates or reads environment files. */
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {lstatSync,realpathSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"'
function requireCheck(ok:unknown,code:string):asserts ok {if(!ok)throw Error(code)}
function healthy(db:DatabaseSync){
 requireCheck(db.prepare('PRAGMA integrity_check').all().every(r=>r.integrity_check==='ok'),'V19_COPY_INTEGRITY')
 requireCheck(db.prepare('PRAGMA foreign_key_check').all().length===0,'V19_COPY_FOREIGN_KEYS')
 const versions=db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r=>Number(r.version))
 requireCheck(versions.length>0&&versions.every((v,i)=>v===i+1),'V19_COPY_VERSION_HISTORY')
 return versions.length
}
function fingerprints(db:DatabaseSync,table:string,columns:string[]) {
 const rows=db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(table)}`);rows.setReadBigInts(true)
 const counts=new Map<string,number>()
 for(const row of rows.iterate()){
  const values=columns.map(c=>{const v=row[c];return v instanceof Uint8Array?['blob',Buffer.from(v).toString('hex')]:typeof v==='bigint'?['integer',String(v)]:[typeof v,v]})
  const hash=createHash('sha256').update(JSON.stringify(values)).digest('hex');counts.set(hash,(counts.get(hash)??0)+1)
 }
 return counts
}
/** Both inputs must be quiescent snapshots of the SAME dataset, before any new events/edits. */
export function verifyV19Copy(beforePath:string,afterPath:string){
 for(const p of [beforePath,afterPath])requireCheck(lstatSync(p).isFile()&&!lstatSync(p).isSymbolicLink(),'V19_COPY_REGULAR_FILES_REQUIRED')
 const a=realpathSync(beforePath),b=realpathSync(afterPath),sa=lstatSync(a),sb=lstatSync(b)
 requireCheck(a!==b&&!(sa.dev===sb.dev&&sa.ino===sb.ino),'V19_COPY_DISTINCT_FILES_REQUIRED')
 const before=new DatabaseSync(a,{readOnly:true})
 try{
  const after=new DatabaseSync(b,{readOnly:true})
  try{
   before.exec('BEGIN');after.exec('BEGIN')
   const beforeVersion=healthy(before),afterVersion=healthy(after)
   requireCheck([18,19,20,21].includes(beforeVersion)&&[19,20,21].includes(afterVersion)&&afterVersion>=beforeVersion,'V19_COPY_EXPECTED_V18_V19_V20_V21')
   const growing=new Set(['schema_migrations','chat_provider_conversations','v20_conversations','v20_associations'])
   const tables=before.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
   const results=[]
   for(const row of tables){
    const table=String(row.name)
    requireCheck(after.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table),'V19_COPY_MISSING_TABLE:'+table)
    const oldColumns=before.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c=>String(c.name)),newColumns=after.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c=>String(c.name))
    requireCheck(oldColumns.every(c=>newColumns.includes(c)),'V19_COPY_MISSING_COLUMN:'+table)
    // V19 increments this revision only when promoting a previously explicit historical link.
    const columns=oldColumns.filter(c=>!(beforeVersion===18&&table==='v20_conversations'&&c==='revision'))
    const oldRows=fingerprints(before,table,columns),newRows=fingerprints(after,table,columns)
    for(const [hash,count]of oldRows)requireCheck((newRows.get(hash)??0)>=count,'V19_COPY_DATA_CHANGED:'+table)
    const oldCount=[...oldRows.values()].reduce((a,b)=>a+b,0),newCount=[...newRows.values()].reduce((a,b)=>a+b,0)
    requireCheck((table==='schema_migrations'||beforeVersion===18&&growing.has(table))?newCount>=oldCount:newCount===oldCount,'V19_COPY_UNEXPECTED_ROWS:'+table)
    if(beforeVersion===18&&table==='v20_conversations')for(const r of before.prepare('SELECT id,revision FROM v20_conversations').all())requireCheck(Number(after.prepare('SELECT revision FROM v20_conversations WHERE id=?').get(r.id!)?.revision)>=Number(r.revision),'V19_COPY_REVISION_REGRESSION')
    results.push({table,beforeRows:oldCount,afterRows:newCount,preserved:true})
   }
   for(const table of ['customer_records','atendimento_references','conversation_initialization','atendimento_contact_events','conversation_message_reads','conversation_read_state','chat_local_context_holds'])requireCheck(after.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table),'V19_COPY_MISSING_V19_TABLE:'+table)
   if(beforeVersion===18)for(const table of ['customer_records','atendimento_references','conversation_initialization','atendimento_contact_events','conversation_message_reads','conversation_read_state'])requireCheck(after.prepare(`SELECT COUNT(*) n FROM ${quote(table)}`).get()!.n===0,'V19_COPY_UNEXPECTED_BACKFILL:'+table)
   if(beforeVersion===18){
    requireCheck(!after.prepare('SELECT 1 FROM atendimentos WHERE closed_at IS NOT NULL LIMIT 1').get(),'V19_COPY_UNEXPECTED_CLOSURE')
    requireCheck(!after.prepare('SELECT 1 FROM v20_conversations WHERE context_revision!=0 LIMIT 1').get(),'V19_COPY_UNEXPECTED_CONTEXT_CHANGE')
   }
   if(afterVersion===21&&beforeVersion<21){
    requireCheck(!after.prepare('SELECT 1 FROM atendimentos WHERE delivery_date IS NOT NULL LIMIT 1').get(),'V19_COPY_UNEXPECTED_DELIVERY_BACKFILL')
    for(const table of ['atendimento_delivery_date_history','work_order_revisions','work_order_revision_pdf_cache'])requireCheck(after.prepare(`SELECT COUNT(*) n FROM ${quote(table)}`).get()!.n===0,'V19_COPY_UNEXPECTED_V21_BACKFILL:'+table)
   }
   return {readOnly:true,beforeVersion,afterVersion,integrity:true,foreignKeys:true,tables:results,limitation:'Comparação de preservação; vínculos promovidos, ambiguidades e contratos externos exigem os casos do roteiro.'}
  }finally{after.close()}
 }finally{before.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  requireCheck(process.argv.length===4,'Uso: node scripts/verify-v19-copy.ts BACKUP_ANTERIOR SNAPSHOT_V19')
  console.log(JSON.stringify(verifyV19Copy(process.argv[2]!,process.argv[3]!),null,2))
 }catch(error){console.error(error instanceof Error&&/^(V19_COPY_|Uso:)/.test(error.message)?error.message:'V19_COPY_CHECK_FAILED');process.exitCode=1}
}
