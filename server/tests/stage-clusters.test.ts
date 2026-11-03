import test from'node:test'
import assert from'node:assert/strict'
import{readFileSync}from'node:fs'
import{randomUUID}from'node:crypto'
import{openDatabase}from'../database.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{codaFixture,set}from'./fixtures/coda-import.ts'
import{TABLES,sourceId}from'../coda-import-source.ts'
import{planImport,applyImport}from'../coda-import.ts'
import{BudgetRepository}from'../budgets.ts'
import{toJsreportData}from'../jsreport-adapter.ts'
import{referencePresentation}from'../stage-presentation.ts'
import{technicalGroups,categoryCents}from'../stage-allocation.ts'
import{Q}from'../exact.ts'
import type{TechnicalStage,BudgetSnapshot}from'../../shared/pricing.ts'
import type{StageCluster}from'../../shared/stage-clusters.ts'
const stage=(id:string,cluster:StageCluster|null,energy:string|null,order=1):TechnicalStage=>({id,name:id,dimension:'Técnica QA',baseEnergy:energy,dimensionEnergy:'0',presentation:{stageId:id,stageDimensionId:'qa',clusterId:null,cluster,order}})
export function clusterFixture(){
 const db=openDatabase(':memory:'),f=commercialFixture(db),cfg=f.pricing.get();cfg.config.services[0]!.base='100';cfg.config.services[0]!.dimensions[0]!.stages=[stage('Preparação QA','Preparação técnica','2'),stage('Pintura QA','Pintura e acabamento','3',2)];f.pricing.save({revision:cfg.revision,config:cfg.config})
 const item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[{...f.item.services[0]!,quantity:'1'}]}),b=new BudgetRepository(db,{render:async()=>Buffer.from('%PDF-1.7\nQA\n%%EOF')}),req={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
 const emit=async(negotiation:unknown={mode:'none'})=>{const r={...req,negotiation},p=b.preview(f.at.id,r);return b.emit(f.at.id,{...r,previewToken:p.token,idempotencyKey:randomUUID()})}
 return{...f,item,db,b,req,emit}
}
const clusters=(s:BudgetSnapshot)=>toJsreportData({id:'qa',atendimentoId:s.atendimento.id,sequence:1,label:'A',createdAt:'2026-11-03T12:00:00Z',documentNumber:'OR-000001',snapshot:s}).diagnosticos

test('stage categories split one service across two categories by energy, preserving exact official prices',async()=>{
 const f=clusterFixture();try{const v=await f.emit(),d=toJsreportData(v).diagnosticos[0]!;assert.deepEqual(d.clusters.map(c=>[c.nome,c.valor]),[['Preparação técnica','R$ 40,00'],['Pintura e acabamento','R$ 60,00']]);assert.equal(v.snapshot.calculation.serviceSubtotal,'100');assert.equal(v.snapshot.calculation.total,'100');const first=d.clusters[0]!;assert(first.tipo==='servico');assert(first.descricaoTexto.some(x=>x.includes('Preparação QA')))}finally{f.db.close()}
})
test('multiple services share a category without losing or doubling either commercial contribution',async()=>{
 const f=clusterFixture();try{f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[...f.item.services,{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'2'}]});const v=await f.emit(),d=toJsreportData(v).diagnosticos[0]!;assert.deepEqual(d.clusters.map(c=>c.valor),['R$ 120,00','R$ 180,00']);assert.equal(d.totalServicos,'R$ 300,00')}finally{f.db.close()}
})
test('different dimensions use their own stages, and distinct diagnoses on the same piece remain separated',async()=>{
 const f=clusterFixture();try{const dim=f.commercial.saveCatalog({kind:'dimensao',name:'Outra dimensão QA',serviceId:f.service.id}),a=f.commercial.saveCatalog({kind:'diagnostico',name:'Dano A'}),b=f.commercial.saveCatalog({kind:'diagnostico',name:'Dano B'}),cfg=f.pricing.get();cfg.config.services[0]!.dimensions.push({dimensionId:dim.id,fd:'2',stages:[stage('Estrutural QA','Correção estrutural','4')]});f.pricing.save({revision:cfg.revision,config:cfg.config});f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,diagnosisId:a.id,services:[...f.item.services,{serviceId:f.service.id,dimensionId:dim.id,quantity:'1',diagnosisId:b.id}]});const v=await f.emit(),d=toJsreportData(v).diagnosticos;assert.equal(d.length,2);assert.deepEqual(new Set(d.map(x=>x.resumo)),new Set(['Dano A','Dano B']));assert.deepEqual(d.flatMap(d=>d.clusters.map(c=>c.valor)).sort(),['R$ 200,00','R$ 40,00','R$ 60,00'].sort());assert.equal(v.snapshot.calculation.total,'300')}finally{f.db.close()}
})
for(const negotiation of[{mode:'discount',value:'10',acknowledgeResidual:false},{mode:'adjust',value:'90',acknowledgeResidual:true},{mode:'adjust',value:'150',acknowledgeResidual:true}])test('stage allocation preserves negotiation '+JSON.stringify(negotiation),async()=>{
 const f=clusterFixture();try{const v=await f.emit(negotiation),data=toJsreportData(v),c=v.snapshot.calculation;assert.equal(data.diagnosticos[0]!.totalServicos,c.serviceSubtotal==='150'?'R$ 150,00':'R$ 100,00');assert.equal(data.financeiro.servicos,c.serviceNet==='150'?'R$ 150,00':'R$ 90,00');assert.equal(data.financeiro.totalVista,data.financeiro.servicos);assert.equal(data.financeiro.desconto,c.discount==='0'?'':'R$ 10,00');assert.deepEqual(data.diagnosticos[0]!.clusters.map(c=>c.valor),c.serviceSubtotal==='150'?['R$ 60,00','R$ 90,00']:['R$ 40,00','R$ 60,00'])}finally{f.db.close()}
})
test('decimal energy and periodic ratios allocate cents by largest remainder, with exact sum and stable ties',()=>{
 const a=categoryCents([{name:'Preparação técnica',amount:new Q(100n,3n),billable:true,descriptions:[]},{name:'Pintura e acabamento',amount:new Q(200n,3n),billable:true,descriptions:[]}]);assert.equal(a.get('Preparação técnica')!.toString(),'33.33');assert.equal(a.get('Pintura e acabamento')!.toString(),'66.67');assert.equal([...a.values()].reduce((s,q)=>s.add(q),new Q(0n)).toString(),'100')
})
for(const bad of['missing','zero-total','unknown','duplicate']as const)test('unrepresentable stage '+bad+' blocks issuance before reservation/HTTP, without changing official calculation',async()=>{
 const f=clusterFixture();try{const cfg=f.pricing.get(),stages=cfg.config.services[0]!.dimensions[0]!.stages;if(bad==='missing'){delete stages[0]!.presentation;stages[0]!.id='new-unclassified-stage'};if(bad==='zero-total')stages.forEach(s=>{s.baseEnergy='0';s.dimensionEnergy='0'});if(bad==='unknown')stages[0]!.presentation!.cluster=null;if(bad==='duplicate')stages.push({...stages[0]!,id:'another-relation'})
 f.pricing.save({revision:cfg.revision,config:cfg.config});const p=f.b.preview(f.at.id,f.req);assert.equal(p.canEmit,false);assert(p.snapshot.pdfPresentation!.errors.length);assert.equal(p.snapshot.calculation.serviceSubtotal,'100');await assert.rejects(f.b.emit(f.at.id,{...f.req,previewToken:p.token,idempotencyKey:randomUUID()}),e=>(e as{code:string}).code==='BUDGET_INCOMPLETE');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM budget_emission_attempts').get()!.n,0)}finally{f.db.close()}
})
test('zero-energy individual stage has zero share; missing energy blocks and does not become equal division',()=>{
 const f=clusterFixture();try{const cfg=f.pricing.get();cfg.config.services[0]!.dimensions[0]!.stages[0]!.baseEnergy='0';f.pricing.save({revision:cfg.revision,config:cfg.config});let p=f.b.preview(f.at.id,f.req);assert(p.canEmit);assert.deepEqual(clusters(p.snapshot)[0]!.clusters.map(c=>c.valor),['R$ 0,00','R$ 100,00']);const next=f.pricing.get();next.config.services[0]!.dimensions[0]!.stages[0]!.baseEnergy=null;f.pricing.save({revision:next.revision,config:next.config});p=f.b.preview(f.at.id,f.req);assert(!p.canEmit);assert(technicalGroups(p.snapshot).errors.some(e=>e.includes('energia')))}finally{f.db.close()}
})
test('reference retains 39 stage IDs, 113 relations and the two explicitly unresolved relations; no name fallback',()=>{
 const a=readFileSync(new URL('../../docs/referencias/pdf/CODA_STAGE_CLUSTERS_2026-11-03.json',import.meta.url)),b=readFileSync(new URL('../data/coda-stage-clusters.json',import.meta.url));assert.deepEqual(a,b);const r=JSON.parse(a.toString());assert.equal(r.stages.length,39);assert.equal(r.relations.length,113);assert.deepEqual(r.relations.filter((r:{stageRowId:string|null})=>!r.stageRowId).map((r:{relationRowId:string})=>r.relationRowId).sort(),['i-cz0vjyEOB7','i-_C-sMqVV7H'].sort());const relation=r.relations[0];assert(referencePresentation(sourceId(TABLES.relations,relation.relationRowId),sourceId(TABLES.services,relation.serviceRowId),sourceId(TABLES.dimensions,relation.serviceDimensionRowId))?.cluster);assert.equal(referencePresentation(sourceId(TABLES.relations,relation.relationRowId),'wrong-service',sourceId(TABLES.dimensions,relation.serviceDimensionRowId)),undefined)
})
test('import preserves stage identity/category/order, safely enriches old JSON and repeats idempotently without replacing local changes',()=>{
 const db=openDatabase(':memory:');try{const source=codaFixture();set(source,TABLES.relations,'c-oh6TT09I-z',2);const initial=planImport(db,source);assert.deepEqual(initial.report.conflicts,[]);applyImport(db,source,initial.planHash);let cfg=JSON.parse(String(db.prepare('SELECT data FROM pricing_configuration').get()!.data));const s=cfg.services[0].dimensions[0].stages[0];assert.equal(s.presentation.cluster,'Preparação técnica');assert.equal(s.presentation.stageId,'i-synthetic-stage');assert.equal(s.presentation.order,2);delete s.presentation;db.prepare('UPDATE pricing_configuration SET data=?').run(JSON.stringify(cfg));const enrich=planImport(db,source);assert.deepEqual(enrich.report.conflicts,[]);assert.equal(enrich.config.services[0]!.dimensions[0]!.stages[0]!.baseEnergy,s.baseEnergy);applyImport(db,source,enrich.planHash);assert.equal(planImport(db,source).report.inserts,0);cfg=JSON.parse(String(db.prepare('SELECT data FROM pricing_configuration').get()!.data));cfg.services[0].dimensions[0].stages[0].presentation.cluster='Pintura e acabamento';db.prepare('UPDATE pricing_configuration SET data=?').run(JSON.stringify(cfg));assert(planImport(db,source).report.conflicts.length)}finally{db.close()}
})

test('two distinct commercial services can contribute to the same technical category without a duplicated shared-stage charge',async()=>{
 const f=clusterFixture();try{const service=f.commercial.saveCatalog({kind:'servico',name:'Outro serviço QA'}),dim=f.commercial.saveCatalog({kind:'dimensao',name:'Outra dimensão QA',serviceId:service.id}),cfg=f.pricing.get();cfg.config.services.push({serviceId:service.id,base:'50',colorFactorEnabled:false,discountable:true,billable:true,dimensions:[{dimensionId:dim.id,fd:'1',stages:[stage('Preparação QA','Preparação técnica','2')]}]});f.pricing.save({revision:cfg.revision,config:cfg.config});f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[...f.item.services,{serviceId:service.id,dimensionId:dim.id,quantity:'2'}]});const v=await f.emit(),d=toJsreportData(v).diagnosticos[0]!;assert.equal(d.clusters.length,2);assert.deepEqual(d.clusters.map(c=>c.valor),['R$ 140,00','R$ 60,00']);assert.equal(v.snapshot.calculation.total,'200')}finally{f.db.close()}
})
test('fractional quantity is used once and decimal stage energies produce the exact ratio before display rounding',async()=>{
 const f=clusterFixture();try{const cfg=f.pricing.get();cfg.config.services[0]!.dimensions[0]!.stages[0]!.baseEnergy='0.1';cfg.config.services[0]!.dimensions[0]!.stages[1]!.baseEnergy='0.2';f.pricing.save({revision:cfg.revision,config:cfg.config});f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[{...f.item.services[0]!,quantity:'0.3'}]});const v=await f.emit(),groups=technicalGroups(v.snapshot);assert.equal(groups.groups[0]!.categories[0]!.amount.toString(),'10');assert.deepEqual(toJsreportData(v).diagnosticos[0]!.clusters.map(c=>c.valor),['R$ 10,00','R$ 20,00']);assert.equal(v.snapshot.calculation.total,'30');assert.equal(v.snapshot.calculation.energy,'0.09')}finally{f.db.close()}
})

test('unknown category and missing metadata stay explicit; an old client cannot erase stored categories',()=>{
 const f=clusterFixture();try{const cfg=f.pricing.get(),bad=structuredClone(cfg.config);bad.services[0]!.dimensions[0]!.stages[0]!.presentation!.cluster='Categoria inventada' as StageCluster;assert.throws(()=>f.pricing.save({revision:cfg.revision,config:bad}),/Categoria de etapa não reconhecida/);const old=structuredClone(cfg.config);delete old.services[0]!.dimensions[0]!.stages[0]!.presentation;const saved=f.pricing.save({revision:cfg.revision,config:old});assert.equal(saved.config.services[0]!.dimensions[0]!.stages[0]!.presentation!.cluster,'Preparação técnica');const p=f.b.preview(f.at.id,f.req);p.snapshot.calculation.lines[0]!.stages[0]!.presentation!.cluster='Categoria inventada' as StageCluster;assert(technicalGroups(p.snapshot).errors.length)}finally{f.db.close()}
})
test('an import with unresolved category remains mathematically usable but cannot issue a misleading PDF',()=>{
 const db=openDatabase(':memory:');try{const source=codaFixture();set(source,TABLES.stages,'c-96H1EFHFA1','Categoria não aprovada');const p=planImport(db,source);assert.deepEqual(p.report.conflicts,[]);assert(p.report.pending.some(x=>x.reason.includes('Categoria de apresentação')));assert.equal(p.config.services[0]!.dimensions[0]!.stages[0]!.presentation!.cluster,null);assert.equal(p.config.services[0]!.dimensions[0]!.stages[0]!.baseEnergy,'2')}finally{db.close()}
})

test('a known original stage cannot be reclassified by a different relation or service name',()=>{
 const f=clusterFixture();try{const cfg=f.pricing.get(),p=cfg.config.services[0]!.dimensions[0]!.stages[0]!.presentation!;p.stageId='i-r-BGU6n_WO';p.cluster='Pintura e acabamento';assert.throws(()=>f.pricing.save({revision:cfg.revision,config:cfg.config}),/referência aprovada/);const snapshot=f.b.preview(f.at.id,f.req).snapshot;snapshot.calculation.lines[0]!.stages[0]!.presentation={...p};assert(technicalGroups(snapshot).errors.length)}finally{f.db.close()}
})
