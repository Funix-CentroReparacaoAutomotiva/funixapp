import {DatabaseSync} from 'node:sqlite'
import {existsSync,lstatSync} from 'node:fs'
import {resolve} from 'node:path'
import {backupDatabase} from './database.ts'
import {registerCustomerPhoneFunction} from './customer-identity-schema.ts'
import {planParticipantGrouping,applyParticipantGrouping} from './participant-grouping.ts'

const [sourceArg,targetArg,...extra]=process.argv.slice(2)
if(!sourceArg||extra.length)throw Error('Uso: node server/group-participants-copy.ts COPIA_EXISTENTE [COPIA_NOVA]')
const source=resolve(sourceArg),target=targetArg?resolve(targetArg):null
if(!lstatSync(source).isFile()||target&&(target===source||existsSync(target)))throw Error('Use uma origem regular e um destino novo e diferente.')
function verify(db:DatabaseSync){
 if(Number(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v)!==25)
   throw Error('Requer cópia V25, sem migração automática.')
 if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)
   throw Error('Cópia com falhas de integridade.')
}
const readOnly=new DatabaseSync(source,{readOnly:true})
try{
 registerCustomerPhoneFunction(readOnly)
 readOnly.exec('BEGIN')
 verify(readOnly)
 const plan=planParticipantGrouping(readOnly)
 if(!target){
   process.stdout.write(JSON.stringify({mode:'preview_only',atendimentos:plan.entries.length,
      references:plan.entries.reduce((n,e)=>n+e.changes.length,0),deferred:plan.deferred})+'\n')
 }else{
   // SQLite online backup makes a consistent copy, including committed WAL data.
   // Source is never opened for writing. Do not permit an existing destination.
   await backupDatabase(readOnly,target)
   const db=new DatabaseSync(target)
   try{
     db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA synchronous=FULL;')
     registerCustomerPhoneFunction(db)
     verify(db)
     const result=applyParticipantGrouping(db,plan)
     verify(db)
     process.stdout.write(JSON.stringify({mode:'copy_only',...result})+'\n')
   }finally{db.close()}
 }
}finally{readOnly.close()}
