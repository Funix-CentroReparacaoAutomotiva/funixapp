/** Offline, read-only evidence. Never opens the application, migrates or reads environment files. */
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {lstatSync,realpathSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"'
function requireCheck(ok:unknown,code:string):asserts ok {if(!ok)throw Error(code)}
function healthy(db:DatabaseSync){
 requireCheck(db.prepare('PRAGMA integrity_check').all().every(r=>r.integrity_check==='ok'),'V18_COPY_INTEGRITY')
 requireCheck(db.prepare('PRAGMA foreign_key_check').all().length===0,'V18_COPY_FOREIGN_KEYS')
 const versions=db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r=>Number(r.version))
 requireCheck(versions.length>0&&versions.every((v,i)=>v===i+1),'V18_COPY_VERSION_HISTORY')
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
export function verifyV18Copy(beforePath:string,afterPath:string){
 for(const p of [beforePath,afterPath])requireCheck(lstatSync(p).isFile()&&!lstatSync(p).isSymbolicLink(),'V18_COPY_REGULAR_FILES_REQUIRED')
 const a=realpathSync(beforePath),b=realpathSync(afterPath),sa=lstatSync(a),sb=lstatSync(b)
 requireCheck(a!==b&&!(sa.dev===sb.dev&&sa.ino===sb.ino),'V18_COPY_DISTINCT_FILES_REQUIRED')
 const before=new DatabaseSync(a,{readOnly:true})
 try{
  const after=new DatabaseSync(b,{readOnly:true})
  try{
   before.exec('BEGIN');after.exec('BEGIN')
   const beforeVersion=healthy(before),afterVersion=healthy(after)
   requireCheck([17,18].includes(beforeVersion)&&afterVersion===18,'V18_COPY_EXPECTED_V17_OR_V18_TO_V18')
   const growing=new Set(['schema_migrations','chat_provider_conversations','v20_conversations','v20_associations'])
   const tables=before.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
   const results=[]
   for(const row of tables){
    const table=String(row.name)
    requireCheck(after.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table),'V18_COPY_MISSING_TABLE:'+table)
    const oldColumns=before.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c=>String(c.name)),newColumns=after.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c=>String(c.name))
    requireCheck(oldColumns.every(c=>newColumns.includes(c)),'V18_COPY_MISSING_COLUMN:'+table)
    // V18 increments this revision only when promoting a previously explicit historical link.
    const columns=oldColumns.filter(c=>!(beforeVersion===17&&table==='v20_conversations'&&c==='revision'))
    const oldRows=fingerprints(before,table,columns),newRows=fingerprints(after,table,columns)
    for(const [hash,count]of oldRows)requireCheck((newRows.get(hash)??0)>=count,'V18_COPY_DATA_CHANGED:'+table)
    const oldCount=[...oldRows.values()].reduce((a,b)=>a+b,0),newCount=[...newRows.values()].reduce((a,b)=>a+b,0)
    requireCheck((beforeVersion===17&&growing.has(table))?newCount>=oldCount:newCount===oldCount,'V18_COPY_UNEXPECTED_ROWS:'+table)
    if(beforeVersion===17&&table==='v20_conversations')for(const r of before.prepare('SELECT id,revision FROM v20_conversations').all())requireCheck(Number(after.prepare('SELECT revision FROM v20_conversations WHERE id=?').get(r.id!)?.revision)>=Number(r.revision),'V18_COPY_REVISION_REGRESSION')
    results.push({table,beforeRows:oldCount,afterRows:newCount,preserved:true})
   }
   for(const table of ['customer_records','atendimento_references','conversation_initialization','atendimento_contact_events','conversation_message_reads','conversation_read_state','chat_local_context_holds'])requireCheck(after.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table),'V18_COPY_MISSING_V18_TABLE:'+table)
   if(beforeVersion===17)for(const table of ['customer_records','atendimento_references','conversation_initialization','atendimento_contact_events','conversation_message_reads','conversation_read_state'])requireCheck(after.prepare(`SELECT COUNT(*) n FROM ${quote(table)}`).get()!.n===0,'V18_COPY_UNEXPECTED_BACKFILL:'+table)
   if(beforeVersion===17){
    requireCheck(!after.prepare('SELECT 1 FROM atendimentos WHERE closed_at IS NOT NULL LIMIT 1').get(),'V18_COPY_UNEXPECTED_CLOSURE')
    requireCheck(!after.prepare('SELECT 1 FROM v20_conversations WHERE context_revision!=0 LIMIT 1').get(),'V18_COPY_UNEXPECTED_CONTEXT_CHANGE')
   }
   return {readOnly:true,beforeVersion,afterVersion,integrity:true,foreignKeys:true,tables:results,limitation:'Comparação de preservação; vínculos promovidos, ambiguidades e contratos externos exigem os casos do roteiro.'}
  }finally{after.close()}
 }finally{before.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  requireCheck(process.argv.length===4,'Uso: node scripts/verify-v18-copy.ts BACKUP_ANTERIOR SNAPSHOT_V18')
  console.log(JSON.stringify(verifyV18Copy(process.argv[2]!,process.argv[3]!),null,2))
 }catch(error){console.error(error instanceof Error&&/^(V18_COPY_|Uso:)/.test(error.message)?error.message:'V18_COPY_CHECK_FAILED');process.exitCode=1}
}
