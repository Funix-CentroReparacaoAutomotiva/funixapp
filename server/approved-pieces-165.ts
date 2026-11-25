// #162 / #165 / #180 — controlled catalog data update, not a schema migration or startup seed.
// Dry run by default; explicit file and matching hash to apply. No environment
// defaults, network, Coda writes, pricing changes or customer-data access.
import {createHash} from 'node:crypto'
import {lstatSync,realpathSync} from 'node:fs'
import {resolve} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {pathToFileURL} from 'node:url'
import {vehicleCatalogProblems} from './default-vehicle-composition.ts'

export const approvedPieces=[
 {code:'veiculo_completo',name:'Veículo completo',existingOnly:false},
 {code:'para_choque_traseiro_inferior',name:'Para-choque traseiro inferior',existingOnly:false},
 {code:'moldura',name:'Moldura',existingOnly:false},
 {code:'moldura_para_lama',name:'Moldura do para-lama',existingOnly:false},
 {code:'moldura_lateral',name:'Moldura lateral',existingOnly:false},
 {code:'moldura_porta_dianteira',name:'Moldura porta dianteira',existingOnly:false},
 {code:'moldura_porta_traseira',name:'Moldura porta traseira',existingOnly:false},
 {code:'moldura_para_choque_dianteiro',name:'Moldura para-choque dianteiro',existingOnly:false},
 {code:'moldura_para_choque_traseiro',name:'Moldura para-choque traseiro',existingOnly:false},
 {code:'para_lama',name:'Para-lama',existingOnly:false},
 {code:'porta_dianteira',name:'Porta dianteira',existingOnly:false},
 {code:'porta_traseira',name:'Porta traseira',existingOnly:false},
 {code:'lateral_traseira',name:'Lateral traseira',existingOnly:false},
 {code:'para_choque_dianteiro',name:'Para-choque dianteiro',existingOnly:true},
 {code:'para_choque_traseiro',name:'Para-choque traseiro',existingOnly:true}
] as const

type Row={id:string;kind:string;code:string|null;name:string;side:string;active:number;revision:number}
type Decision={code:string;name:string;id:string;action:'insert'|'reuse'|'conflict';reason:string}
const normalize=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g,' ').trim()
const equivalentName=(s:string)=>normalize(s).replace(/\b(da|do|de)\b/g,'').replace(/\s+/g,' ').trim()
const stableId=(code:string)=>'funix:peca:'+code
const equivalentAliases:Record<string,readonly string[]>={veiculo_completo:['veiculo'],para_choque_traseiro_inferior:['para choque inferior traseiro']}

export function planApprovedPieces(db:DatabaseSync){
 const versions=db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row=>Number(row.version))
 if(![20,21,22,23,24,25,26,27].includes(versions.length)||versions.some((v,i)=>v!==i+1))throw new Error('Atualização de catálogo #162/#165/#180 exige um banco existente V20, V21, V22, V23, V24, V25, V26 ou V27. Não executa migrações.')
 const rows=db.prepare('SELECT id,kind,code,name,side,active,revision FROM catalog_items ORDER BY id').all() as Row[]
 const relevant=rows.filter(r=>r.kind==='peca'||approvedPieces.some(p=>r.id===stableId(p.code)||r.code===p.code))
 const decisions:Decision[]=approvedPieces.map(piece=>{
  const matches=relevant.filter(r=>r.code===piece.code||r.id===stableId(piece.code)||
    (r.kind==='peca'&&!r.side&&(equivalentName(r.name)===equivalentName(piece.name)||
      (equivalentAliases[piece.code]?.includes(equivalentName(r.name))??false)||
      (piece.code==='moldura'&&normalize(r.name)==='moldura generica'))))
  if(matches.length===1){
   const r=matches[0]!
   if(r.kind==='peca'&&r.code===piece.code&&r.active===1&&r.side===''&&r.name===piece.name)
    return {code:piece.code,name:piece.name,id:r.id,action:'reuse',reason:'Cadastro ativo equivalente; identidade e histórico preservados.'}
  }
  if(matches.length||piece.existingOnly)
   return {code:piece.code,name:piece.name,id:matches[0]?.id??stableId(piece.code),action:'conflict',reason:'Cadastro ausente, inativo, renomeado ou conflitante; não duplicar, reativar ou sobrescrever.'}
  return {code:piece.code,name:piece.name,id:stableId(piece.code),action:'insert',reason:'Peça sem lado, autorizada pela direção; não implica expansão automática.'}
 })
 const planHash=createHash('sha256').update(JSON.stringify({version:'funix-approved-pieces-162-165-180-v4',versions,relevant,decisions,prerequisites:vehicleCatalogProblems(db)})).digest('hex')
 const prerequisites=vehicleCatalogProblems(db)
 return {planHash,decisions,prerequisites,conflicts:decisions.filter(d=>d.action==='conflict')}
}

export function applyApprovedPieces(db:DatabaseSync,confirmation:string){
 if(!/^[a-f0-9]{64}$/.test(confirmation))throw new Error('Confirmação inválida.')
 db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE')
 try{
  const plan=planApprovedPieces(db)
  if(plan.planHash!==confirmation)throw new Error('Catálogo mudou desde o dry-run; gere novo plano.')
  if(plan.prerequisites.length)throw new Error('Pré-requisitos #162 ausentes: '+plan.prerequisites.join(', '))
  if(plan.conflicts.length)throw new Error('Conflito no catálogo; nenhuma alteração aplicada.')
  const now=new Date().toISOString()
  const insert=db.prepare("INSERT INTO catalog_items(id,kind,code,name,status,source,created_at,updated_at) VALUES (?,'peca',?,?,'proposta','operador',?,?)")
  const history=db.prepare('INSERT INTO catalog_history(item_id,revision,changed_at,data) VALUES (?,?,?,?)')
  for(const d of plan.decisions.filter(d=>d.action==='insert')){
   insert.run(d.id,d.code,d.name,now,now)
   const row=db.prepare('SELECT * FROM catalog_items WHERE id=?').get(d.id)
   history.run(d.id,1,now,JSON.stringify(row))
  }
  db.exec('COMMIT')
  return plan
 }catch(error){db.exec('ROLLBACK');throw error}
}

export function main(args:string[]){
 const opts=new Map<string,string>()
 for(let i=0;i<args.length;i++){
  const key=args[i]!,value=args[++i]
  if(!['--database','--confirm-plan'].includes(key)||opts.has(key)||!value||value.startsWith('--'))throw new Error('Uso: node server/approved-pieces-165.ts --database COPIA.sqlite [--confirm-plan HASH]')
  opts.set(key,value)
 }
 if(!opts.has('--database'))throw new Error('Informe uma cópia SQLite existente explicitamente.')
 const filename=resolve(opts.get('--database')!),confirmation=opts.get('--confirm-plan')
 if(!lstatSync(filename).isFile()||lstatSync(filename).isSymbolicLink()||realpathSync(filename)!==filename)throw new Error('Arquivo existente sem links simbólicos obrigatório.')
 const db=new DatabaseSync(filename,{readOnly:!confirmation})
 try{
  const plan=confirmation?applyApprovedPieces(db,confirmation):planApprovedPieces(db)
  console.log(JSON.stringify({mode:confirmation?'applied':'dry-run',...plan},null,2))
  return plan.conflicts.length||plan.prerequisites.length?2:0
 }finally{db.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{process.exitCode=main(process.argv.slice(2))}
 catch(error){console.error('Atualização recusada:',error instanceof Error?error.message:'Erro desconhecido.');process.exitCode=1}
}
