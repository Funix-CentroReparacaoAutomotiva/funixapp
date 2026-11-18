// Offline, explicitly authorized energy-only reconciliation (#157/#244).
// Source import is validated in an isolated scratch DB; no general import into
// the destination. No writes to catalog, prices, settings, snapshots or OS.
import {DatabaseSync} from 'node:sqlite'
import {readFileSync,lstatSync,realpathSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {approvedEnergyDimensions} from './approved-stage-energy.ts'
import {TABLES,sourceId,parseCodaJson} from './coda-import-source.ts'
import {planImport,digest} from './coda-import.ts'
import {openDatabase} from './database.ts'
import type {PricingConfig,TechnicalStage} from '../shared/pricing.ts'

type Finding={serviceId:string;dimensionId:string;action:'restore'|'unchanged'|'conflict';reason:string;before:TechnicalStage[];after:TechnicalStage[]}
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v
const same=(a:unknown,b:unknown)=>digest(canonical(a))===digest(canonical(b))
function check(db:DatabaseSync){
 const versions=db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r=>Number(r.version))
 if(![20,21,22].includes(versions.length)||versions.some((v,i)=>v!==i+1))throw Error('Reconciliação exige SQLite V20, V21 ou V22 existente, sem migração.')
 if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Banco inconsistente; operação recusada.')
}

export function planEnergyReconciliation(db:DatabaseSync,source:unknown){
 check(db)
 const stored=db.prepare('SELECT revision,data,updated_at FROM pricing_configuration WHERE id=1').get()
 if(!stored)throw Error('Configuração de preços ausente.')
 const config=JSON.parse(String(stored.data)) as PricingConfig
 const scratch=openDatabase(':memory:')
 let imported:ReturnType<typeof planImport>
 try{imported=planImport(scratch,source)}finally{scratch.close()}
 if(imported.report.conflicts.length)throw Error('Exportação Coda contém conflitos; reconciliação recusada.')
 const findings:Finding[]=[]
 const catalogCheck=db.prepare('SELECT id,kind,name,service_id,active,revision FROM catalog_items WHERE id=?')
 const targetCatalog=[]
 for(const group of approvedEnergyDimensions()){
  const serviceId=sourceId(TABLES.services,group.serviceId),dimensionId=sourceId(TABLES.dimensions,group.dimensionId)
  const localService=config.services.filter(s=>s.serviceId===serviceId)
  const localDim=localService.length===1?localService[0]!.dimensions.filter(d=>d.dimensionId===dimensionId):[]
  const original=localDim[0]
  const expected=imported.config.services.find(s=>s.serviceId===serviceId)?.dimensions.find(d=>d.dimensionId===dimensionId)
  const before=structuredClone(original?.stages??[]),after=structuredClone(expected?.stages??[])
  const service=catalogCheck.get(serviceId),dimension=catalogCheck.get(dimensionId)
  targetCatalog.push({service,dimension})
  const sourceService=imported.catalog.find(c=>c.id===serviceId),sourceDimension=imported.catalog.find(c=>c.id===dimensionId)
  const report=(action:Finding['action'],reason:string)=>findings.push({serviceId,dimensionId,action,reason,before,after})
  const complete=after.length===group.relations.length&&group.relations.every(r=>{
   const id=sourceId(TABLES.relations,r.id),stage=after.find(s=>s.id===id)
   return stage?.baseEnergy===r.energy&&stage.dimensionEnergy==='0'&&!!stage.presentation?.cluster&&
     imported.report.imported.some(f=>f.source===id&&f.reason.startsWith('Energia aprovada pela direção'))
  })
  if(!complete){report('conflict','Origem não comprovou o conjunto integral aprovado de relações, energia e categoria.');continue}
  if(!service||service.kind!=='servico'||service.active!==1||service.name!==sourceService?.name||
     !dimension||dimension.kind!=='dimensao'||dimension.active!==1||dimension.service_id!==serviceId||dimension.name!==sourceDimension?.name||
     localService.length!==1||localDim.length!==1||!original||!Array.isArray(original.stages)){
   report('conflict','Serviço/dimensão local ausente, inativo, alterado ou ambíguo. Nenhuma criação automática.');continue
  }
  if(same(before,after)){report('unchanged','Etapas já correspondem exatamente à configuração aprovada.');continue}
  if(before.length!==0){report('conflict','Etapas locais não vazias divergem; preservar e revisar manualmente.');continue}
  original.stages=structuredClone(after)
  report('restore','Restaurar conjunto completo de etapas aprovadas; preservar todos os demais campos.')
 }
 const targetDigest=digest({stored,targetCatalog,versions:db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()}),sourceDigest=imported.sourceDigest
 const planHash=digest({operation:'approved-energy-reconciliation-v1',targetDigest,sourceDigest,findings})
 return {planHash,targetDigest,sourceDigest,findings,conflicts:findings.filter(f=>f.action==='conflict'),config,revision:Number(stored.revision)}
}

export function applyEnergyReconciliation(db:DatabaseSync,source:unknown,confirmation:string){
 if(!/^[a-f0-9]{64}$/.test(confirmation))throw Error('Hash inválido.')
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; BEGIN IMMEDIATE')
 try{
  const p=planEnergyReconciliation(db,source)
  if(p.planHash!==confirmation)throw Error('Plano mudou; execute novo dry-run.')
  if(p.conflicts.length)throw Error('Conflitos pendentes; nenhuma energia gravada.')
  if(p.findings.some(f=>f.action==='restore')){
   const result=db.prepare('UPDATE pricing_configuration SET data=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?').run(JSON.stringify(p.config),new Date().toISOString(),p.revision)
   if(result.changes!==1)throw Error('Revisão de configuração mudou.')
  }
  check(db)
  db.exec('COMMIT')
  return p
 }catch(error){db.exec('ROLLBACK');throw error}
}

export function main(args:string[]){
 const values=new Map<string,string>()
 for(let i=0;i<args.length;i++){
  const key=args[i]!,value=args[++i]
  if(!['--source','--database','--confirm-plan'].includes(key)||values.has(key)||!value||value.startsWith('--'))throw Error('Uso: node server/reconcile-approved-energy.ts --source export.json --database COPIA.sqlite [--confirm-plan HASH]')
  values.set(key,value)
 }
 if(!values.has('--source')||!values.has('--database'))throw Error('Informe exportação Coda e cópia SQLite explicitamente.')
 const file=resolve(values.get('--database')!),src=resolve(values.get('--source')!),hash=values.get('--confirm-plan')
 if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()||realpathSync(file)!==file)throw Error('Arquivo SQLite existente, sem links simbólicos, obrigatório.')
 if(!lstatSync(src).isFile()||lstatSync(src).size>20*1024*1024)throw Error('Exportação inválida ou excede 20 MiB.')
 const source=parseCodaJson(readFileSync(src,'utf8'))
 const db=new DatabaseSync(file,{readOnly:!hash})
 try{
  const p=hash?applyEnergyReconciliation(db,source,hash):planEnergyReconciliation(db,source)
  console.log(JSON.stringify({mode:hash?'applied':'dry-run',planHash:p.planHash,sourceDigest:p.sourceDigest,targetDigest:p.targetDigest,revision:p.revision,findings:p.findings,conflicts:p.conflicts},null,2))
  return p.conflicts.length?2:0
 }finally{db.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{process.exitCode=main(process.argv.slice(2))}
 catch(error){console.error('Reconciliação recusada:',error instanceof Error?error.message:'Erro desconhecido.');process.exitCode=1}
}
