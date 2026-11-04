// Offline administrative command; deliberately does not load .env or the application DB default.
import {readFileSync,lstatSync,realpathSync} from 'node:fs'
import {resolve} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {pathToFileURL} from 'node:url'
import {applyImport,planImport} from './coda-import.ts'
import {parseCodaJson} from './coda-import-source.ts'

export function main(args:string[]){
 const values=new Map<string,string>()
 for(let n=0;n<args.length;n++){
  const key=args[n]!
  if(!['--source','--database','--confirm-plan'].includes(key) || values.has(key) || !args[n+1] || args[n+1]!.startsWith('--'))throw new Error('Uso: node server/import-coda.ts --source export.json --database copia-v8-v9-ou-v10.sqlite [--confirm-plan HASH_DO_DRY_RUN]')
  values.set(key,args[++n]!)
 }
 if(!values.has('--source') || !values.has('--database'))throw new Error('Informe explicitamente --source e --database. Sem opções o comando não acessa banco algum.')
 const file=resolve(values.get('--database')!),sourceFile=resolve(values.get('--source')!)
 if(!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || realpathSync(file)!==file)throw new Error('O banco deve ser arquivo V8, V9, V10, V11 ou V12 existente, sem links simbólicos no caminho.')
 if(lstatSync(sourceFile).size>20*1024*1024)throw new Error('Exportação excede limite de 20 MiB.')
 const source=parseCodaJson(readFileSync(sourceFile,'utf8')),confirmation=values.get('--confirm-plan')
 if(confirmation && !/^[a-f0-9]{64}$/.test(confirmation))throw new Error('Confirmação inválida.')
 const db=new DatabaseSync(file,{readOnly:!confirmation})
 try{
  const plan=confirmation?applyImport(db,source,confirmation):planImport(db,source)
  console.log(JSON.stringify({mode:confirmation?'applied':'dry-run',sourceDigest:plan.sourceDigest,targetDigest:plan.targetDigest,planHash:plan.planHash,catalog:plan.catalog,...plan.report},null,2))
  return plan.report.conflicts.length?2:0
 }finally{db.close()}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{process.exitCode=main(process.argv.slice(2))}
 catch(error){console.error('Importação recusada:',error instanceof Error?error.message:'Erro desconhecido.');process.exitCode=1}
}
