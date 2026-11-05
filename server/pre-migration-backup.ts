import {randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {existsSync,lstatSync,unlinkSync} from 'node:fs'
import {resolve} from 'node:path'
import {backupDatabase} from './database.ts'

/**
 * Protect the existing SQLite file before the first V12 -> V13 startup.
 * This snapshot stays in the existing private volume, outside the container image.
 * Failed or incomplete snapshots block migration rather than risking existing data.
 * A separate off-host backup is still recommended before operational rollout.
 */
export async function backupBeforeVoiceMigration(filename:string):Promise<string|null>{
 if(filename===':memory:')return null
 const source=resolve(filename)
 if(!existsSync(source))return null
 if(lstatSync(source).isSymbolicLink())throw new Error('O banco da FUNIX não pode ser link simbólico.')
 const db=new DatabaseSync(source,{readOnly:true})
 try{
  const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()
  if(!table)return null
  const version=Number(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version??0)
  if(version!==12)return null
  if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw new Error('Banco SQLite inconsistente antes da migração V13.')
  const destination=source+'.pre-v13-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.sqlite'
  await backupDatabase(db,destination)
  let verified:DatabaseSync|null=null
  try{
   verified=new DatabaseSync(destination,{readOnly:true})
   if(verified.prepare('PRAGMA quick_check').get()?.quick_check!=='ok'||
      Number(verified.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version)!==12){
    throw new Error('Backup V12 inválido; a migração foi bloqueada.')
   }
  }catch(error){unlinkSync(destination);throw error}
  finally{verified?.close()}
  return destination
 }finally{db.close()}
}
