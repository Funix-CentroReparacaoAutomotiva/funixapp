import {DatabaseSync} from 'node:sqlite'
import {lstatSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {registerCustomerPhoneFunction} from './customer-identity-schema.ts'
import {backupDatabase} from './database.ts'
import {consolidateLegacyCustomers} from './chat/legacy-consolidation.ts'

const [sourceArg,targetArg,...extra]=process.argv.slice(2)
if(!sourceArg||!targetArg||extra.length)throw Error('Uso: node server/consolidate-legacy-copy.ts ORIGEM_EXISTENTE COPIA_NOVA')
const source=resolve(sourceArg),target=resolve(targetArg)
if(source===target||existsSync(target)||!lstatSync(source).isFile())throw Error('Use uma origem regular e um destino novo e diferente.')
const readOnly=new DatabaseSync(source,{readOnly:true})
try{
  if(![23,24,25,26,27,28,29,30].includes(Number(readOnly.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v)))
    throw Error('Requer origem V23 a V29; nenhuma migração automática.')
  await backupDatabase(readOnly,target)
}finally{readOnly.close()}
const db=new DatabaseSync(target)
try{
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA synchronous=FULL;')
  registerCustomerPhoneFunction(db)
  const preview=consolidateLegacyCustomers(db)
  const applied=consolidateLegacyCustomers(db,true)
  if(JSON.stringify(preview)!==JSON.stringify(applied))throw Error('Relatórios divergentes. Não utilize esta cópia.')
  process.stdout.write(JSON.stringify({mode:'copy_only',...applied})+'\n')
}finally{db.close()}
