// Explicit administrative operation, no .env/startup hooks, network or default database.
import{lstatSync,readFileSync,realpathSync}from'node:fs'
import{resolve}from'node:path'
import{pathToFileURL}from'node:url'
import{DatabaseSync}from'node:sqlite'
import{createHash}from'node:crypto'
import{applyRecommendations,planRecommendations}from'./diagnosis-recommendations.ts'
export function main(args:string[]){
 const values=new Map<string,string>()
 for(let i=0;i<args.length;i++){
  const key=args[i]!
  if(!['--source','--database','--confirm-plan'].includes(key)||values.has(key)||!args[i+1]||args[i+1]!.startsWith('--'))throw Error('Uso: node server/import-recommendations.ts --source regras.json --database copia-v9.sqlite [--confirm-plan HASH]')
  values.set(key,args[++i]!)
 }
 if(!values.has('--source')||!values.has('--database'))throw Error('Informe --source e --database explicitamente; nenhum banco será presumido.')
 const file=resolve(values.get('--database')!),sourceFile=resolve(values.get('--source')!),confirmation=values.get('--confirm-plan')
 if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()||realpathSync(file)!==file)throw Error('Use banco V9 existente sem links simbólicos; o comando não cria banco.')
 if(!lstatSync(sourceFile).isFile()||lstatSync(sourceFile).size>4*1024*1024)throw Error('Fonte inválida ou maior que 4 MiB.')
 if(confirmation&&!/^[a-f0-9]{64}$/.test(confirmation))throw Error('Hash de confirmação inválido.')
 const raw=readFileSync(sourceFile,'utf8');let source:unknown
 try{source=JSON.parse(raw)}catch{throw Error('JSON de regras inválido; conteúdo não será exibido.')}
 const db=new DatabaseSync(file,{readOnly:!confirmation})
 try{
  const plan=confirmation?applyRecommendations(db,source,confirmation):planRecommendations(db,source)
  console.log(JSON.stringify({mode:confirmation?'applied':'dry-run',fileSHA256:createHash('sha256').update(raw).digest('hex'),sourceDigest:plan.sourceDigest,targetDigest:plan.targetDigest,planHash:plan.planHash,...plan.report},null,2))
  return plan.report.conflicts.length?2:0
 }finally{db.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{process.exitCode=main(process.argv.slice(2))}catch(e){console.error('Carga de regras recusada:',e instanceof Error?e.message:'Erro desconhecido');process.exitCode=1}}
