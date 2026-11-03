import type{DatabaseSync}from'node:sqlite'
import{commercialFixture}from'./commercial.ts'
import{codaServiceId}from'../../../shared/commercial-curation.ts'
// Synthetic QA only: no private export, prices or production database are read.
export function curationFixture(db:DatabaseSync){
 const f=commercialFixture(db),ids={free:codaServiceId('i-lMM5GA_1uz'),protection:codaServiceId('i-odnULcJj8z'),third:codaServiceId('i-6FW6UIOr8H'),hidden:codaServiceId('i-qCp1gLfJn4'),legacy:codaServiceId('i-JPNGbPVOdw'),technical:codaServiceId('i-GsuErCDZgL'),inspection:codaServiceId('i-dMshyG5NMo')}
 const names={free:'Descontaminação QA',protection:'Proteção QA',third:'Elétrica QA',hidden:'Interna QA',legacy:'Encantamento QA',technical:'Diagnóstico Técnico QA',inspection:'Inspeção técnica QA'}
 const insert=db.prepare("INSERT INTO catalog_items(id,kind,name,service_id,status,source,created_at,updated_at) VALUES(?,?,?,?,'proposta','operador','QA','QA')")
 const dimensions:Record<keyof typeof ids,string>={} as Record<keyof typeof ids,string>
 const config=structuredClone(f.pricing.get().config)
 for(const key of Object.keys(ids) as (keyof typeof ids)[]){
  insert.run(ids[key],'servico',names[key],null);const dimension='qa-curation-dimension:'+key;insert.run(dimension,'dimensao','Dimensão QA '+key,ids[key]);dimensions[key]=dimension
  config.services.push({serviceId:ids[key],billable:true,discountable:true,colorFactorEnabled:true,base:'100.01',dimensions:[{dimensionId:dimension,fd:'1',stages:[{id:'qa-step:'+key,name:'Etapa QA',dimension:'Técnica QA',presentation:{stageId:null,stageDimensionId:null,clusterId:null,cluster:'Preparação técnica' as const,order:null},baseEnergy:'2',dimensionEnergy:'3'}]}]})
 }
 f.pricing.save({revision:f.pricing.get().revision,config})
 return{...f,ids,dimensions}
}

// Complete shape for importer coverage: 28 approved service identities, 16 QA
// diagnoses and 75 QA dimensions. All prices, stages and labels are synthetic.
export async function fullCurationSource(){
 const{codaFixture,table,row,ref,pushRow}=await import('./coda-import.ts')
 const{TABLES}=await import('../../coda-import-source.ts')
 const{SERVICE_POLICIES}=await import('../../../shared/commercial-curation.ts')
 const s=codaFixture(),serviceIds=Object.keys(SERVICE_POLICIES),counts=[1,1,5,4,3,3,1,1,0,1,4,4,4,6,4,5,3,1,4,3,1,5,1,4,1,1,1,3]
 function clear(id:string){const t=table(s,id);t.rows=[];t.totalRows=0;t.schema.rowCount=0}
 for(const t of [TABLES.services,TABLES.dimensions,TABLES.rules,TABLES.relations,TABLES.diagnoses])clear(t)
 pushRow(s,TABLES.dimensions,row('i-qa-sentinel',{'c-DGi7Us0d5f':ref(TABLES.dimensionNames,'i-synthetic-all-name')}))
 for(let i=0;i<16;i++)pushRow(s,TABLES.diagnoses,row('i-qa-diagnosis-'+i,{'c-QduKALgMf1':i===15?'Cuidados operacionais QA':'Diagnóstico QA '+i}))
 for(const[id,i]of serviceIds.map((id,i)=>[id,i]as const)){
  const original=id.split(':').at(-1)!
  pushRow(s,TABLES.services,row(original,{'c-TvFH_jzZ3k':'Serviço QA '+i,'c-mJimiTomMd':true,'c-r5HLQrISpN':true}))
  pushRow(s,TABLES.rules,row('i-qa-rule-'+i,{'c-VdW_35TQkv':ref(TABLES.tables,'i-synthetic-table'),'c-8CxdK7Oln0':ref(TABLES.services,original),'c-trJtxn7Rnm':ref(TABLES.dimensions,'i-qa-sentinel'),'c-4i-UJzr0Ry':{name:'calculado'},'c-sGROPfan5w':100.01,'c-jIfhQ2URf5':false,'c--xF4R7C4Rv':true}))
  for(let d=0;d<counts[i]!;d++){
   const name='i-qa-name-'+i+'-'+d,dim='i-qa-dim-'+i+'-'+d
   pushRow(s,TABLES.dimensionNames,row(name,{'c-FJw9NIz2cO':'Dimensão QA '+i+'/'+d}))
   pushRow(s,TABLES.dimensions,row(dim,{'c-TvFH_jzZ3k':ref(TABLES.services,original),'c-DGi7Us0d5f':ref(TABLES.dimensionNames,name),'c-YB4iqbCDp_':d===0&&i===1?null:1,'c-wZoGYfi40i':5}))
   pushRow(s,TABLES.relations,row('i-qa-relation-'+i+'-'+d,{'c-7sr002IvYn':ref(TABLES.services,original),'c-EBO2IBlQEH':ref(TABLES.dimensions,dim),'c-AWrfBjSHDl':ref(TABLES.stages,'i-synthetic-stage'),'c-B9QLxROotP':ref(TABLES.stageDimensions,'i-synthetic-stage-dimension'),'c-Ii7Vzlr1ni':5,'c-rTdEY2ynPh':1}))
  }
 }return s
}
