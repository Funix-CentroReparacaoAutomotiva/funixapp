import{referencePresentation,clusterById,clusterName,sourceStageCluster}from'./stage-presentation.ts'
import{COMMERCIAL_CURATION,servicePolicy}from'../shared/commercial-curation.ts'
import{CURATION_STAMP}from'./curation.ts'
import {createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import type {CatalogKind} from '../shared/commercial.ts'
import type {PricingConfig,ServicePricing,TechnicalStage} from '../shared/pricing.ts'
import {Q,sum} from './exact.ts'
import {PricingConfigurationRepository} from './pricing-config.ts'
import {migrate} from './migrations.ts'
import {DOCUMENT,TABLES,FORMULAS,cell,scalar,label,sourceId} from './coda-import-source.ts'
import type {CodaExport,SourceRow} from './coda-import-source.ts'

export const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const formulaHash=(v:string)=>createHash('sha256').update(v).digest('hex')
// Direction approval, not inferred from Coda flags or fator_curadoria. IDs survive renames.
const approvedNoColorServices=new Set(['i-qCp1gLfJn4','i-AlsNigbGqx','i-dMshyG5NMo']) // Interna, Lavagem, Inspeção técnica
const approvedMR={id:'funix:mr:padrao',name:'Padrão',factor:'1.2'}
interface Entry {id:string;kind:CatalogKind;name:string;serviceId:string|null}
interface Finding {source:string;reason:string}
export interface ImportPlan {
 sourceDigest:string; targetDigest:string; planHash:string
 catalog:Entry[]; config:PricingConfig
 report:{curation?:{version:string;digest:string;services:{id:string;visible:boolean;billing:string;execution:string;canonicalBlocked:boolean}[]}; sourceCounts:Record<string,number>; imported:Finding[]; pending:Finding[]; conflicts:Finding[]; warnings:Finding[]; mapping:{source:string;target:string}[]; inserts:number; unchanged:number}
}
function fail(message:string):never {throw new Error(message)}
function exact(v:unknown):string|null {
 v=scalar(v)
 if(v===null || v===undefined || v==='')return null
 if(typeof v!=='string' && typeof v!=='number')return null
 try{return Q.from(String(v)).toString()}catch{return null}
}
function checkDatabase(db:DatabaseSync){
 const versions=db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r=>Number(r.version))
 if(![8,9,10,11,12].includes(versions.length)||versions.some((v,i)=>v!==i+1))fail('A importação exige banco existente com schema exatamente V8, V9, V10, V11 ou V12; não executa migrações.')
 if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok' || db.prepare('PRAGMA foreign_key_check').all().length)fail('Banco com falha de integridade; importação recusada.')
}
function targetState(db:DatabaseSync){return {catalog:db.prepare('SELECT * FROM catalog_items ORDER BY id').all(),pricing:db.prepare('SELECT * FROM pricing_configuration ORDER BY id').all()}}

/** Pure planning against an existing V7 database; no target writes, network or migrations. */
export function planImport(db:DatabaseSync,input:unknown):ImportPlan {
 checkDatabase(db)
 const source=input as CodaExport
 if(!source || source.format!=='funix-coda-commercial-v1' || source.documentId!==DOCUMENT || !Array.isArray(source.tables) || !Number.isFinite(Date.parse(source.exportedAt)))fail('Exportação comercial inválida ou documento incorreto.')
 const report:ImportPlan['report']={sourceCounts:{},imported:[],pending:[],conflicts:[],warnings:[],mapping:[],inserts:0,unchanged:0}
 const pending=(source:string,reason:string)=>report.pending.push({source,reason})
 const warning=(source:string,reason:string)=>report.warnings.push({source,reason})
 const conflict=(source:string,reason:string)=>report.conflicts.push({source,reason})
 const tables=new Map(source.tables.map(t=>[t.id,t]))
 if(tables.size!==source.tables.length)fail('Tabela duplicada na exportação.')
 for(const id of Object.values(TABLES)){
  const t=tables.get(id)
  if(!t || !Array.isArray(t.rows) || !Array.isArray(t.schema?.columns) || t.hasMore || t.rows.length!==t.totalRows || t.totalRows!==t.schema.rowCount)fail(`Exportação incompleta: ${id}.`)
  if(new Set(t.rows.map(r=>r.rowId)).size!==t.rows.length || t.rows.some(r=>!/^i-[\w-]+$/.test(r.rowId) || !r.values || typeof r.values!=='object'))fail(`Identidade de origem inválida/duplicada: ${id}.`)
  report.sourceCounts[id]=t.rows.length
 }
 const rows=(id:string)=>tables.get(id)!.rows
 const row=(id:string,key:string)=>rows(id).find(r=>r.rowId===key)
 const ref=(r:SourceRow,c:string,t:string):SourceRow|null=>{
  const v=cell(r,c)
  if(!v || typeof v!=='object' || !('rowId' in v) || typeof v.rowId!=='string' || ('isBroken' in v && v.isBroken) ||
   ('targetTableId' in v && v.targetTableId!==t) || ('tableId' in v && v.tableId!==t))return null
  return row(t,v.rowId)??null
 }
 const id=(t:string,r:SourceRow)=>sourceId(t,r.rowId)
 const number=(r:SourceRow,c:string)=>exact(cell(r,c))
 const catalog:Entry[]=[]
 const add=(t:string,r:SourceRow,kind:CatalogKind,name:string,serviceId:string|null=null)=>{
  if(!name || name.length>250){pending(id(t,r),'Nome ausente/inválido.');return}
  catalog.push({id:id(t,r),kind,name,serviceId});report.mapping.push({source:`${t}/${r.rowId}`,target:id(t,r)})
 }
 for(const r of rows(TABLES.services)){
  if(!servicePolicy(id(TABLES.services,r)))conflict(id(TABLES.services,r),'ID de serviço sem política explícita de curadoria; carga recusada.');
  const name=label(cell(r,'c-TvFH_jzZ3k'));add(TABLES.services,r,'servico',name)
  if(/mec[aâ]nica|el[eé]trica|eletr[oô]nica|vidra|refrigera/i.test(name))warning(id(TABLES.services,r),'Possível serviço terceirizado/fora da execução interna: mantido ativo, sem exclusão automática.')
  if(typeof cell(r,'c-mJimiTomMd')!=='boolean' || typeof cell(r,'c-r5HLQrISpN')!=='boolean')pending(id(TABLES.services,r),'Faturável/descontável ausente: desconto não será permitido por omissão.')
 }
 for(const r of rows(TABLES.diagnoses))add(TABLES.diagnoses,r,'diagnostico',label(cell(r,'c-QduKALgMf1')))
 const dimensions=new Map<string,{row:SourceRow;service:SourceRow;name:string;fd:string|null}>()
 const sentinels=new Set<string>()
 for(const r of rows(TABLES.dimensions)){
  const n=ref(r,'c-DGi7Us0d5f',TABLES.dimensionNames),name=n?label(cell(n,'c-FJw9NIz2cO')):''
  if(name==='__ALL_dim__'){sentinels.add(r.rowId);pending(id(TABLES.dimensions,r),'Sentinela __ALL_dim__: somente fallback de regra, nunca dimensão selecionável.');continue}
  const s=ref(r,'c-TvFH_jzZ3k',TABLES.services)
  if(!n || !s || !catalog.some(c=>c.id===id(TABLES.services,s))){pending(id(TABLES.dimensions,r),'Referência de serviço/nome de dimensão quebrada.');continue}
  add(TABLES.dimensions,r,'dimensao',name,id(TABLES.services,s))
  if(!catalog.some(c=>c.id===id(TABLES.dimensions,r)))continue
  dimensions.set(r.rowId,{row:r,service:s,name,fd:number(r,'c-YB4iqbCDp_')})
 }
 const formulas=[...(source.pricingFormulaSchema?.columns??[]),...tables.get(TABLES.relations)!.schema.columns,...tables.get(TABLES.dimensions)!.schema.columns]
 const verified=(keys:(keyof typeof FORMULAS)[])=>keys.every(k=>{const f=formulas.find(c=>c.columnId===k)?.formula;return typeof f==='string' && formulaHash(f)===FORMULAS[k]})
 const priceVerified=verified(['c-CTMaCn6A8p','c-hxarcKkPOG','c-JfloaDYRDT','c-p7zvvJmXk5'])
 const energyVerified=verified(['c-Ii7Vzlr1ni','c-wZoGYfi40i'])
 if(!priceVerified)pending('pricingFormulaSchema','Fórmulas de preço diferentes/ausentes: bases e FD bloqueados até conferência.')
 if(!energyVerified)pending(TABLES.relations,'Fórmulas de energia diferentes/ausentes: etapas bloqueadas até conferência.')
 const factors=(t:string,name:string,value:string)=>rows(t).flatMap(r=>{
  const factor=number(r,value),n=label(cell(r,name))
  if(factor===null || !n){pending(id(t,r),'Fator/nome ausente ou decimal incompatível com V7.');return []}
  report.mapping.push({source:`${t}/${r.rowId}`,target:id(t,r)});return [{id:id(t,r),name:n,factor}]
 })
 const colors=factors(TABLES.colors,'c-I7ZHbkxSjh','c-fbLxVOP4TA'),risks=factors(TABLES.risks,'c-cxXfUPrtG8','c-OIxnmBPdct')
 const bases=rows(TABLES.tables).filter(r=>!cell(r,'c-DMeUkMin9e') && label(cell(r,'c-tZ94U6MuW-'))==='Padrao' && number(r,'c-QMXNRk1uDX')==='1' && cell(r,'c-o2aKUZyPE7')===true)
 const baseline=bases.length===1?bases[0]:undefined
 const commercialTables=rows(TABLES.tables).flatMap(r=>{
  const name=label(cell(r,'c-CeD0PIBx4t'))
  if(!name){pending(id(TABLES.tables,r),'Tabela sem nome.');return []}
  // Issue #20 explicitly adopts the simple global FV model, not Coda inheritance.
  const factor=cell(r,'c-o2aKUZyPE7')===true?number(r,'c-QMXNRk1uDX'):null
  if(factor===null)pending(id(TABLES.tables,r),'FV ausente/inválido ou tabela não ativa na fonte atual.')
  report.mapping.push({source:`${TABLES.tables}/${r.rowId}`,target:id(TABLES.tables,r)})
  return [{id:id(TABLES.tables,r),name,factor}]
 })
 const ruleGroups=new Map<string,SourceRow[]>()
 for(const r of rows(TABLES.rules)){
  const t=ref(r,'c-VdW_35TQkv',TABLES.tables),s=ref(r,'c-8CxdK7Oln0',TABLES.services),d=ref(r,'c-trJtxn7Rnm',TABLES.dimensions)
  const type=label(cell(r,'c-4i-UJzr0Ry'))
  if(t && !cell(r,'c-8CxdK7Oln0') && type==='percentual'){warning(id(TABLES.rules,r),'Fallback percentual global Coda ignorado: Issue #20 usa FV explícito da tabela.');continue}
  if(!t || !s || !d){pending(id(TABLES.rules,r),'Referência ausente/quebrada ou fallback global por serviço: sem conversão automática.');continue}
  const key=JSON.stringify([t.rowId,s.rowId,d.rowId]);const group=ruleGroups.get(key)??[];group.push(r);ruleGroups.set(key,group)
  if(type==='percentual')warning(id(TABLES.rules,r),'Percentual/herança Coda não transportado: Issue #20 define FV global da tabela.')
  else if(!['calculado','tabelado'].includes(type))pending(id(TABLES.rules,r),'Regra sem tipo reconhecido; não convertida em preço.')
  else if(t!==baseline && type==='calculado')warning(id(TABLES.rules,r),'Base alternativa Coda ignorada: uma única base por serviço, conforme Issue #20.')
  if(cell(r,'c--xF4R7C4Rv')===false)warning(id(TABLES.rules,r),'Flag FR Coda não transportada: FR sempre incide no normal pela Issue #20.')
 }
 for(const group of ruleGroups.values())if(group.length>1)pending(group.map(r=>id(TABLES.rules,r)).join(', '),'Chave de regra duplicada: nenhuma precedência First() presumida.')
 const services:ServicePricing[]=[]
 for(const s of rows(TABLES.services)){
  if(!catalog.some(c=>c.id===id(TABLES.services,s)))continue
  const serviceRules=rows(TABLES.rules).filter(r=>ref(r,'c-8CxdK7Oln0',TABLES.services)===s)
  const colorFlags=serviceRules.map(r=>cell(r,'c-jIfhQ2URf5'))
  const uniqueColors=new Set(colorFlags)
  const approvedNoColor=approvedNoColorServices.has(s.rowId)
  const colorFactorEnabled=approvedNoColor?false:uniqueColors.size===1 && typeof colorFlags[0]==='boolean'?colorFlags[0]:null
  if(approvedNoColor)report.imported.push({source:id(TABLES.services,s),reason:'Decisão da direção, PR #21 comentário 6500884942: FC desabilitado neste serviço; FR normal preservado.'})
  if(colorFactorEnabled===null)pending(id(TABLES.services,s),'FC por serviço pendente: regras específicas ausentes, inválidas ou divergentes entre tabelas. Nenhuma tabela escolhida arbitrariamente.')
  const discountable=cell(s,'c-r5HLQrISpN')===true
  const rawBillable=cell(s,'c-mJimiTomMd'),billable=typeof rawBillable==='boolean'?rawBillable:null
  const dims=[...dimensions.values()].filter(d=>d.service===s)
  const candidates=dims.map(d=>{
   let group=baseline?ruleGroups.get(JSON.stringify([baseline.rowId,s.rowId,d.row.rowId])):undefined
   if(!group && baseline){const fallbacks=[...sentinels].flatMap(key=>ruleGroups.get(JSON.stringify([baseline.rowId,s.rowId,key]))??[]);if(fallbacks.length)group=fallbacks}
   const rule=group?.length===1?group[0]:undefined
   const value=priceVerified && rule && label(cell(rule,'c-4i-UJzr0Ry'))==='calculado'?number(rule,'c-sGROPfan5w'):null
   return {d,rule,value}
  })
  const values=new Set(candidates.map(c=>c.value).filter(v=>v!==null)),base=values.size===1?[...values][0]!:null
  if(base===null)pending(id(TABLES.services,s),'Preço base raiz ausente ou divergente por dimensão: sem conversão em preço especial.')
  const pricedDimensions=candidates.map(({d,rule,value})=>{
   let fd=value!==null && base!==null?d.fd:null
   if(fd===null)pending(id(TABLES.dimensions,d.row),'FD/preço sem correspondência comprovada: cálculo permanece bloqueado.')
   const relations=rows(TABLES.relations).filter(r=>ref(r,'c-7sr002IvYn',TABLES.services)===s && ref(r,'c-EBO2IBlQEH',TABLES.dimensions)===d.row)
   if(relations.some(r=>number(r,'c-rTdEY2ynPh')!=='1')){fd=null;pending(id(TABLES.dimensions,d.row),'Escala por quantidade diferente de 1 ou ausente não equivale a quantidade linear V7.')}
   const stages:TechnicalStage[]=[]
   let validEnergy=energyVerified && relations.length>0
   for(const r of relations){
    const st=ref(r,'c-AWrfBjSHDl',TABLES.stages),sd=ref(r,'c-B9QLxROotP',TABLES.stageDimensions)
    const be=st?ref(st,'c-K6LT-CKgWA',TABLES.energy):null,de=sd?ref(sd,'c-ufXqc_8vWI',TABLES.energy):null
    const baseEnergy=be?number(be,'c-3-8rupyDNx'):null,dimensionEnergy=de?number(de,'c-3-8rupyDNx'):null
    const name=st?label(cell(st,'c-TvFH_jzZ3k')):'',dimension=sd?label(cell(sd,'c-tb4TOqyqh7')):''
    const actual=number(r,'c-Ii7Vzlr1ni')
    if(!st || !sd || !name || !dimension || baseEnergy===null || dimensionEnergy===null || actual===null || Q.from(baseEnergy).add(Q.from(dimensionEnergy)).cmp(Q.from(actual))!==0){
     validEnergy=false
     const negative=[be,de].some(e=>e && String(scalar(cell(e,'c-3-8rupyDNx'))).startsWith('-'))
     const reason=negative?'Energia negativa histórica; inclusive quando compensada por outra parcela.':!st||!sd||!be||!de?'Referência técnica/energia ausente ou quebrada.':'Energia inválida ou soma divergente.'
     pending(id(TABLES.relations,r),reason+' Conjunto não liberado nem convertido em zero.');continue
    }
    const prior=referencePresentation(id(TABLES.relations,r),id(TABLES.services,s),id(TABLES.dimensions,d.row))
    const rawCluster=cell(st,'c-96H1EFHFA1'),clusterId=rawCluster&&typeof rawCluster==='object'&&'rowId'in rawCluster&&typeof rawCluster.rowId==='string'?rawCluster.rowId:null
    const brokenCluster=rawCluster&&typeof rawCluster==='object'&&'isBroken'in rawCluster&&rawCluster.isBroken
    let cluster=brokenCluster?null:rawCluster===undefined?(prior?.stageId===st.rowId?prior.cluster:null):clusterId?clusterById(clusterId):clusterName(label(rawCluster))
    if(sourceStageCluster(st.rowId)&&cluster!==sourceStageCluster(st.rowId))cluster=null
    const rawOrder=scalar(cell(r,'c-oh6TT09I-z')),order=rawOrder===undefined?prior?.order??null:typeof rawOrder==='number'||typeof rawOrder==='string'&&/^\d+$/.test(rawOrder)?Number(rawOrder):null
    const presentation={stageId:st.rowId,stageDimensionId:sd.rowId,clusterId:rawCluster===undefined?prior?.clusterId??null:clusterId,cluster,order:Number.isSafeInteger(order)&&Number(order)>=0?order:null}
    if(!cluster)pending(id(TABLES.relations,r),'Categoria de apresentação ausente/não reconhecida; preço/energia preservados, emissão PDF pendente.')
    stages.push({id:id(TABLES.relations,r),name,dimension,baseEnergy,dimensionEnergy,presentation})
   }
   const total=number(d.row,'c-wZoGYfi40i')
   if(total===null || !validEnergy || sum(stages.map(st=>Q.from(st.baseEnergy!).add(Q.from(st.dimensionEnergy!)))).cmp(Q.from(total??'0'))!==0){validEnergy=false;pending(id(TABLES.dimensions,d.row),'Conjunto de etapas incompleto/incompatível com a energia total Coda; nenhuma etapa parcial liberada.')}
   if(rule && fd!==null && base!==null){report.imported.push({source:id(TABLES.rules,rule),reason:`Base/FD da fonte para ${id(TABLES.dimensions,d.row)}; cálculo segue FC por serviço e FV/FR da Issue #20, não regras históricas por tabela.`});report.mapping.push({source:`${TABLES.rules}/${rule.rowId}`,target:`services/${id(TABLES.services,s)}/${id(TABLES.dimensions,d.row)}`})}
   return {dimensionId:id(TABLES.dimensions,d.row),fd,stages:validEnergy?stages:[]}
  })
  services.push({serviceId:id(TABLES.services,s),colorFactorEnabled,discountable,billable,base,dimensions:pricedDimensions})
 }
 // Report invalid links even when they do not belong to any otherwise usable dimension.
 for(const r of rows(TABLES.relations)){
  const s=ref(r,'c-7sr002IvYn',TABLES.services),d=ref(r,'c-EBO2IBlQEH',TABLES.dimensions)
  if(!s || !d || !ref(r,'c-AWrfBjSHDl',TABLES.stages) || !ref(r,'c-B9QLxROotP',TABLES.stageDimensions))pending(id(TABLES.relations,r),'Referência técnica quebrada/ausente.')
  else if(dimensions.get(d.rowId)?.service!==s)pending(id(TABLES.relations,r),'Serviço da relação não corresponde ao pai da dimensão; associação não inferida por nome.')
 }
 for(const r of rows(TABLES.diagnosisServices))pending(id(TABLES.diagnosisServices,r),'Sugestão automática diagnóstico/intensidade → serviço não faz parte do contrato V7; seleção manual preservada.')
 warning(TABLES.app,'fator_curadoria não é convertido em MR. MR Padrão 1.2 vem da decisão explícita da direção, PR #21 comentário 6500884942.')
 warning(TABLES.rules,'Quantidades abaixo de 1 têm resultado diferente no Coda (Fator Quantidade Produto / Qnt.). A V7 preserva a regra aprovada de quantidade linear, inclusive fracionária; equivalência de preço declarada somente para quantidade >= 1.')
 const capRows=rows(TABLES.capacity),capacity=capRows.length===1?number(capRows[0]!,'c-hnqUeXrBqw'):null
 if(capacity===null || Q.from(capacity).n===0n)pending(TABLES.capacity,'Capacidade global positiva não comprovada.')
 const old=new PricingConfigurationRepository(db).get(),config=structuredClone(old.config)
 // Additive import only. Different source/local values require manual review, never overwrite.
 const merge=<T>(old:T[],incoming:T[],key:(v:T)=>string)=>{
  for(const v of incoming){const k=key(v),present=old.find(o=>key(o)===k)
   if(present){if(digest(present)!==digest(v))conflict(k,'Valor já existente diverge; nenhuma sobrescrita.');else report.unchanged++}
   else {old.push(v);report.inserts++}
  }
 }
 merge(config.tables,commercialTables,v=>v.id);merge(config.colors,colors,v=>v.id);merge(config.risks,risks,v=>v.id);// Enrich only absent presentation metadata when the complete old pricing/energy payload matches.
 for(const incoming of services){
  const existing=config.services.find(s=>s.serviceId===incoming.serviceId)
  if(!existing)continue
  const withoutPresentation=(s:ServicePricing)=>({...s,dimensions:s.dimensions.map(d=>({...d,stages:d.stages.map(({presentation:_,...stage})=>stage)}))})
  if(digest(withoutPresentation(existing))!==digest(withoutPresentation(incoming)))continue
  for(const dim of incoming.dimensions)for(const stage of dim.stages){
   const oldStage=existing.dimensions.find(d=>d.dimensionId===dim.dimensionId)?.stages.find(s=>s.id===stage.id)
   if(oldStage&&!oldStage.presentation&&stage.presentation){oldStage.presentation=structuredClone(stage.presentation);report.imported.push({source:stage.id,reason:'Metadados de apresentação ausentes acrescentados; preços, energias e IDs preservados.'})}
  }
 }
 merge(config.services,services,v=>v.serviceId)
 const mrOptions=config.resaleMultipliers??=[]
 const mrName=(value:string)=>value.trim().normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR')
 const localMR=mrOptions.filter(m=>m.id===approvedMR.id || mrName(m.name)===mrName(approvedMR.name))
 if(!localMR.length){mrOptions.push({...approvedMR});report.inserts++}
 else if(localMR.length===1 && mrName(localMR[0]!.name)===mrName(approvedMR.name) && exact(localMR[0]!.factor)===approvedMR.factor)report.unchanged++
 else conflict(approvedMR.id,'MR Padrão local divergente ou duplicado; configuração preservada, sem substituir valor/identidade nem selecionar Atendimento.')
 report.imported.push({source:'direction:pr21:6500884942',reason:'Opção MR Padrão 1.2 autorizada pela direção; cadastro apenas, sem seleção automática em Atendimentos.'})
 if(capacity!==null && Q.from(capacity).n>0n){if(config.capacity===null){config.capacity=capacity;report.inserts++}else if(config.capacity!==capacity)conflict(TABLES.capacity,'Capacidade local diferente; não sobrescrever.');else report.unchanged++}
 // Only explicitly tabled, dimension-specific source rules may become exact exceptions.
 const specials:PricingConfig['specialPrices']=[]
 for(const group of ruleGroups.values()){
  if(group.length!==1)continue
  const r=group[0]!
  if(label(cell(r,'c-4i-UJzr0Ry'))!=='tabelado')continue
  const t=ref(r,'c-VdW_35TQkv',TABLES.tables)!,s=ref(r,'c-8CxdK7Oln0',TABLES.services)!,d=ref(r,'c-trJtxn7Rnm',TABLES.dimensions)!,unit=number(r,'c-sGROPfan5w')
  if(!priceVerified || sentinels.has(d.rowId) || dimensions.get(d.rowId)?.service!==s || unit===null){pending(id(TABLES.rules,r),'Preço tabelado sem chave exata/valor válido; nenhuma expansão da sentinela.');continue}
  specials.push({tableId:id(TABLES.tables,t),serviceId:id(TABLES.services,s),dimensionId:id(TABLES.dimensions,d),unit})
 }
 merge(config.specialPrices,specials,v=>JSON.stringify([v.tableId,v.serviceId,v.dimensionId]))
 // Existing prices, MR options/selections and conditions are never replaced.
 for(const item of catalog){
  const existing=db.prepare('SELECT * FROM catalog_items WHERE id=?').get(item.id)
  if(existing){if(existing.kind!==item.kind || existing.name!==item.name || existing.service_id!==item.serviceId || existing.active!==1)conflict(item.id,'Cadastro importado já editado/inativado ou incompatível; preservado.');else report.unchanged++}
  else {
   const collision=db.prepare('SELECT id,name FROM catalog_items WHERE kind=? AND service_id IS ?').all(item.kind,item.serviceId).find(r=>String(r.name).trim().normalize('NFC').toLocaleLowerCase('pt-BR')===item.name.normalize('NFC').toLocaleLowerCase('pt-BR'))
   if(collision)conflict(item.id,`Possível duplicata local ${collision.id}; nomes não são usados como chave para associação automática.`)
   else report.inserts++
  }
 }
 const names=new Map<string,Entry[]>()
 for(const c of catalog){const key=JSON.stringify([c.kind,c.serviceId,c.name.normalize('NFC').toLocaleLowerCase('pt-BR')]),group=names.get(key)??[];group.push(c);names.set(key,group)}
 for(const group of names.values())if(group.length>1)conflict(group.map(g=>g.id).join(', '),'Nomes duplicados na origem para mesmo tipo/pai; resolver antes de gravar.')
 if(config.commercialCuration && digest(config.commercialCuration)!==digest(CURATION_STAMP))conflict('commercialCuration','Política local divergente; nenhuma substituição automática.')
 if(!config.commercialCuration){config.commercialCuration={...CURATION_STAMP};report.inserts++}
 report.curation={...CURATION_STAMP,services:catalog.filter(c=>c.kind==='servico').flatMap(c=>{const p=servicePolicy(c.id);return p?[{id:c.id,visible:p.visible,billing:p.billing,execution:p.execution,canonicalBlocked:!!p.canonicalBlocked}]:[]})}
 // Visibility is policy, NOT catalog.active: preserve existing legacy references.
 const candidate={sourceDigest:digest(source),targetDigest:digest(targetState(db)),catalog,config,curation:COMMERCIAL_CURATION}
 // Validate the complete merged configuration with current repository contracts in memory.
 if(!report.conflicts.length){
 const validation=new DatabaseSync(':memory:')
 try{
  migrate(validation)
  const existing=db.prepare('SELECT id,kind,name,service_id AS serviceId FROM catalog_items WHERE kind!=\'peca\' ORDER BY service_id IS NOT NULL,id').all() as unknown as Entry[]
  for(const c of [...existing,...catalog])insertCatalog(validation,c)
  candidate.config=new PricingConfigurationRepository(validation).save({revision:1,config}).config
 }finally{validation.close()}
 }
 const planHash=digest(candidate)
 return {...candidate,planHash,report}
}
function insertCatalog(db:DatabaseSync,c:Entry){
 const now=new Date().toISOString()
 const result=db.prepare("INSERT INTO catalog_items(id,kind,name,service_id,status,source,created_at,updated_at) VALUES(?,?,?,?,'proposta','operador',?,?) ON CONFLICT(id) DO NOTHING").run(c.id,c.kind,c.name,c.serviceId,now,now)
 if(result.changes){const r=db.prepare('SELECT * FROM catalog_items WHERE id=?').get(c.id)!;db.prepare('INSERT INTO catalog_history(item_id,revision,changed_at,data) VALUES(?,?,?,?)').run(c.id,1,now,JSON.stringify(r))}
}
/** Re-plans under the write lock. All catalog/history/config writes commit together. */
export function applyImport(db:DatabaseSync,source:unknown,confirmation:string){
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; BEGIN IMMEDIATE')
 try{
  const plan=planImport(db,source)
  if(plan.planHash!==confirmation)fail('Plano mudou: execute dry-run novamente antes de aplicar.')
  if(plan.report.conflicts.length)fail('Conflitos pendentes; nenhuma gravação realizada.')
  for(const c of plan.catalog)insertCatalog(db,c)
  const old=new PricingConfigurationRepository(db).get()
  if(digest(old.config)!==digest(plan.config))db.prepare('UPDATE pricing_configuration SET data=?,revision=revision+1,updated_at=? WHERE id=1').run(JSON.stringify(plan.config),new Date().toISOString())
  checkDatabase(db)
  db.exec('COMMIT');return plan
 }catch(error){db.exec('ROLLBACK');throw error}
}
