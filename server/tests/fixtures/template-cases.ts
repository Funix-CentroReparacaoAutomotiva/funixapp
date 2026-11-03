// Only synthetic in-memory data. Never reads the installed database or private exports.
import{randomUUID}from'node:crypto'
import{openDatabase}from'../../database.ts'
import{BudgetRepository}from'../../budgets.ts'
import{ComponentRepository}from'../../components.ts'
import{curationFixture}from'./curation.ts'
export const TEMPLATE_CASES=['normal','discount','adjust-down','adjust-up','free','mixed','components','empty-details','long','fractional']as const
export type TemplateCase=typeof TEMPLATE_CASES[number]
export async function templateCase(name:TemplateCase){
 const db=openDatabase(':memory:')
 try{
  const f=curationFixture(db),components=new ComponentRepository(db)
  f.atendimentos.update(f.at.id,{revision:f.at.revision,name:name==='empty-details'?'':name==='normal'?'Pessoa QA <script>alert(1)</script> & ação':'Cliente sintético QA',phone:'123456',plate:name==='empty-details'?'':'QA00000',vehicle:name==='empty-details'?'':'Veículo sintético'})
  const diagnosis=f.commercial.saveCatalog({kind:'diagnostico',name:'Quebrado QA'})
  let item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,diagnosisId:diagnosis.id,intensity:'moderado'})
  if(name==='free'||name==='mixed')item=f.commercial.updateDiagnosis(f.at.id,item.id,{revision:item.revision,services:[...(name==='mixed'?item.services:[]),{serviceId:f.ids.free,dimensionId:f.dimensions.free,quantity:'1'}]})
  if(name==='components'){
   item=f.commercial.updateDiagnosis(f.at.id,item.id,{revision:item.revision,services:[]})
   const scene=f.scenarios.list(f.at.id)[0]!;f.scenarios.update(f.at.id,scene.id,{revision:scene.revision,deadline:{mode:'manual',manualDays:2}})
  }
  if(name!=='free'&&name!=='empty-details')components.save(f.at.id,{pieceId:item.id,name:name==='normal'?'Componente QA & <b>teste</b>':'Componente sintético QA',quantity:name==='fractional'?'0.00005':'2',manualPrice:'50',notes:'Nota QA'})
  if(name==='long'){
   const codes=f.commercial.catalogs().items.filter(p=>p.kind==='peca'&&p.active&&p.code&&p.code!=='capo').slice(0,20)
   for(const piece of codes){const row=f.commercial.add(f.at.id,{pieceCodes:[piece.code!]}).find(r=>r.pieceId===piece.id)!;f.commercial.updateDiagnosis(f.at.id,row.id,{revision:row.revision,diagnosisId:diagnosis.id,intensity:'leve',services:[{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'1',notes:'Observação sintética de paginação. '.repeat(6)}]})}
  }
  if(name==='fractional')item=f.commercial.updateDiagnosis(f.at.id,item.id,{revision:item.revision,services:[{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'0.1'}]})
  const negotiation=name==='discount'?{mode:'discount',value:'50',acknowledgeResidual:false}:name==='adjust-down'?{mode:'adjust',value:'450.15',valueIncludesComponents:true,acknowledgeResidual:true}:name==='adjust-up'?{mode:'adjust',value:'750.15',valueIncludesComponents:true,acknowledgeResidual:true}:{mode:'none'}
  const budgets=new BudgetRepository(db,{render:async()=>Buffer.from('%PDF-1.7\nsynthetic contract fixture\n%%EOF')}),request={scenarioId:f.scenario.id,negotiation},preview=budgets.preview(f.at.id,request)
  if(!preview.canEmit)throw Error(JSON.stringify(preview.snapshot.calculation.errors))
  const version=await budgets.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:randomUUID()})
  return{version,preview}
 }finally{db.close()}
}
