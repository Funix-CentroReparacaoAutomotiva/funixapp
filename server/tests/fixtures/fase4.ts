import type{DatabaseSync}from'node:sqlite'
import{commercialFixture}from'./commercial.ts'
import{codaServiceId,servicePolicy}from'../../../shared/commercial-curation.ts'
import{sourceId,TABLES}from'../../coda-import-source.ts'
// Synthetic catalogs/rules only, seeded directly for QA; never imports private sources.
export function fase4Fixture(db:DatabaseSync,empty=true){
 const f=commercialFixture(db),diagnosis=f.commercial.saveCatalog({kind:'diagnostico',name:'Dano Fase4 SINTÉTICO'}),otherDiagnosis=f.commercial.saveCatalog({kind:'diagnostico',name:'Outro dano Fase4 SINTÉTICO'}),services=[['Montagem','i-vmJ3Org23i',true],['Funilaria','i-q8IL0mnuIJ',true],['Pintura','i-XDTMBmueos',true],['Degradê','i-SW0n7TLbtf',false],['Alinhamento','i-6tWzUWof8c',false],['Terceiro QA','i-6FW6UIOr8H',true],['Técnico bloqueado QA','i-GsuErCDZgL',true],['Encantamento bloqueado QA','i-JPNGbPVOdw',true],['Sem curadoria QA','i-qa-unapproved',true]]as const
 const now=new Date().toISOString(),catalog=db.prepare("INSERT INTO catalog_items(id,kind,name,service_id,status,source,created_at,updated_at)VALUES(?,?,?,?,'proposta','operador',?,?)"),rules=db.prepare("INSERT INTO diagnosis_recommendations(id,source_table,source_row_id,diagnosis_id,intensity,service_id,dimension_id,selected_by_default,status,reason)VALUES(?,?,?,?,?,?,?,?,?,?)"),config=f.pricing.get()
 const entries=services.map(([name,row,selected],i)=>{
  const serviceId=codaServiceId(row),dimensionId=sourceId(TABLES.dimensions,'i-f4-dim-'+i);catalog.run(serviceId,'servico',name+' SINTÉTICO',null,now,now);catalog.run(dimensionId,'dimensao','M QA',serviceId,now,now)
  config.config.services.push({serviceId,base:'10.01',colorFactorEnabled:false,billable:servicePolicy(serviceId)?.billing!=='not_billed',discountable:true,dimensions:[{dimensionId,fd:'1',stages:[{id:'qa-step-'+i,name:'Etapa SINTÉTICA',dimension:'QA',baseEnergy:'1',dimensionEnergy:'1'}]}]})
  for(const [d,n]of[[diagnosis,0],[otherDiagnosis,1]]as const)for(const intensity of['leve','moderado','severo']){const rowId='i-f4-'+n+'-'+intensity+'-'+i;rules.run(sourceId(TABLES.diagnosisServices,rowId),TABLES.diagnosisServices,rowId,d.id,intensity,serviceId,dimensionId,selected?1:0,'valid',null)}
  return{name,serviceId,dimensionId,selected}
 })
 for(const intensity of['leve','moderado','severo']){const rowId='i-f4-pending-'+intensity;rules.run(sourceId(TABLES.diagnosisServices,rowId),TABLES.diagnosisServices,rowId,diagnosis.id,intensity,entries[0]!.serviceId,entries[2]!.dimensionId,1,'pending','DIMENSION_SERVICE_MISMATCH')}
 f.pricing.save({revision:config.revision,config:config.config})
 const item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,diagnosisId:null,intensity:null,...(empty?{services:[]}:{} )})
 const second=f.scenarios.create(f.at.id,{name:'Outro QA',duplicateFrom:f.scenarios.list(f.at.id)[0]!.id,sourceRevision:f.scenarios.list(f.at.id)[0]!.revision})
 return{...f,item,diagnosis,otherDiagnosis,entries,second}
}
