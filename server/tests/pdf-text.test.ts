import test from'node:test'
import assert from'node:assert/strict'
import{randomUUID}from'node:crypto'
import{pdfExpression,pdfDiagnosis,pdfStage}from'../pdf-text.ts'
import{openDatabase}from'../database.ts'
import{commercialFixture}from'./fixtures/commercial.ts'
import{BudgetRepository}from'../budgets.ts'
import{ComponentRepository}from'../components.ts'
import{toJsreportData,frozenTerms}from'../jsreport-adapter.ts'
import{renderJsreportPdf}from'../jsreport-client.ts'
import type{BudgetVersion,TechnicalStage}from'../../shared/pricing.ts'

for(const[input,expected]of[
 ['Para-lama · Passageiro','Para-lama passageiro'],
 ['  Para-choque  ·  Dianteiro  ','Para-choque dianteiro'],
 ['Alma Do Para-choque · Traseiro','Alma do para-choque traseiro'],
 ['Coluna A · Dianteira','Coluna A dianteira'],
 ['Pintura UV-C Mercedes-Benz','Pintura UV-C Mercedes-Benz'],
 ['Polimento São Paulo 3M','Polimento São Paulo 3M'],
 ['Roda BMW M3 · Passageiro','Roda BMW M3 passageiro'],
 ['iPhone 3M','iPhone 3M'],
 ['Pintura eBay UV','Pintura eBay UV'],
]as const)test('PDF sentence presentation: '+input,()=>assert.equal(pdfExpression(input),expected))
for(const[intensity,expected]of[['leve','Amassado leve'],['moderado','Amassado moderado'],['severo','Amassado severo']]as const)test('PDF masculine intensity: '+intensity,()=>assert.equal(pdfDiagnosis('Amassado',intensity),expected))
for(const[input,expected]of[
 ['Desmontagem (Dimensão média · Qtd.: 1)','Desmontagem'],
 ['montagem (Média · Qtd.: 0.25)','Montagem'],
 ['pintura UV','Pintura UV'],
 ['aplicação 3M','Aplicação 3M'],
 ['correção (PDR)','Correção (PDR)'],
 ['Pintura Ford Mustang','Pintura Ford Mustang'],
]as const)test('PDF stage name only: '+input,()=>assert.equal(pdfStage(input),expected))

test('PDF summary uses clean names and ordered deduplicated stages without changing financial allocation or source data',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),catalogPiece=f.commercial.item(f.item.pieceId)
  f.commercial.saveCatalog({revision:catalogPiece.revision,name:'Para-lama · Passageiro'},catalogPiece.id)
  const diagnosis=f.commercial.saveCatalog({kind:'diagnostico',name:'Amassado'})
  const item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,diagnosisId:diagnosis.id,intensity:'moderado',services:f.item.services.map(s=>({...s,notes:'Nota interna: não mostrar ao cliente'}))})
  const cfg=f.pricing.get(),names=['desmontagem (Dimensão média · Qtd.: 1)','montagem','preparação','colorimetria','DESMONTAGEM','pintura','acabamento']
  cfg.config.services[0]!.dimensions[0]!.stages=names.map((name,i)=>({id:'qa-display-'+i,name,dimension:'Dimensão técnica interna',baseEnergy:i===4?'0':i<4?'0.5':'1.5',dimensionEnergy:'0',presentation:{stageId:'qa-display-'+i,stageDimensionId:null,clusterId:null,cluster:i<5?'Preparação técnica':'Pintura e acabamento',order:i}}satisfies TechnicalStage))
  f.pricing.save({revision:cfg.revision,config:cfg.config})
  new ComponentRepository(db).save(f.at.id,{pieceId:item.id,name:'Componente sintético',quantity:'2',manualPrice:'50',notes:''})
  const b=new BudgetRepository(db,{render:async()=>Buffer.from('%PDF-1.7\nsynthetic only\n%%EOF')}),request={scenarioId:f.scenario.id,negotiation:{mode:'discount',value:'50',acknowledgeResidual:false}},preview=b.preview(f.at.id,request)
  const before=JSON.stringify(preview.snapshot),data=toJsreportData({id:'qa',atendimentoId:f.at.id,sequence:1,label:'A',createdAt:'2026-11-03T12:00:00Z',documentNumber:'OR-000001',snapshot:preview.snapshot})
  assert.equal(data.diagnosticos[0]!.nome,'Para-lama passageiro');assert.equal(data.diagnosticos[0]!.resumo,'Amassado moderado')
  const service=data.diagnosticos[0]!.clusters.filter(c=>c.tipo==='servico')
  assert.deepEqual(service.map(c=>c.nome),['Preparação técnica','Pintura e acabamento'])
  assert.deepEqual(service[0]!.descricaoTexto,['Desmontagem','Montagem','Preparação','Colorimetria'])
  assert.equal(service[0]!.descricaoTexto.join(' • '),'Desmontagem • Montagem • Preparação • Colorimetria')
  assert.deepEqual(service[1]!.descricaoTexto,['Pintura','Acabamento'])
  assert.deepEqual(service.map(c=>c.valor),['R$ 120,06','R$ 180,09'])
  assert.deepEqual(data.financeiro,{servicos:'R$ 250,15',pecas:'R$ 200,00',desconto:'R$ 50,00',totalVista:'R$ 450,15'})
  assert(!JSON.stringify(service).includes('Qtd.'));assert(!JSON.stringify(service).includes('Dimensão'));assert(!JSON.stringify(service).includes('Nota interna'))
  assert.equal(JSON.stringify(preview.snapshot),before)
  assert.equal(f.commercial.item(catalogPiece.id).name,'Para-lama · Passageiro');assert.equal(f.commercial.item(diagnosis.id).name,'Amassado')
  assert.equal(preview.snapshot.calculation.lines[0]!.quantity,'3');assert.equal(preview.snapshot.calculation.lines[0]!.stages.length,7)
  const version=await b.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:randomUUID()})
  assert.deepEqual(version.snapshot.calculation,preview.snapshot.calculation);assert.deepEqual(version.snapshot.installments,preview.snapshot.installments);assert.deepEqual(version.snapshot.executionDeadline,preview.snapshot.executionDeadline)
  assert.equal(version.snapshot.composition.items[0]!.notes,item.notes)
 }finally{db.close()}
})

test('historical snapshot, original PDF bytes and frozen renderer JSON remain literal despite new presentation rules',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),b=new BudgetRepository(db,{render:async()=>{throw Error('Must not render a historical download')}}),p=b.preview(f.at.id,{scenarioId:f.scenario.id,negotiation:{mode:'none'}})
  const id=randomUUID(),snapshot=structuredClone(p.snapshot),old:BudgetVersion={id,atendimentoId:f.at.id,sequence:1,label:'A',createdAt:'2026-11-03T12:00:00Z',documentNumber:'OR-000099',snapshot}
  const data=toJsreportData(old);data.diagnosticos[0]!.nome='Para-lama · Passageiro';data.diagnosticos[0]!.resumo='Amassado · Moderada'
  const cluster=data.diagnosticos[0]!.clusters[0]!;assert(cluster.tipo==='servico');cluster.descricaoTexto=['Desmontagem (Dimensão média · Qtd.: 1)']
  snapshot.document={template:'FUNIX - Orcamento',data}
  const json=JSON.stringify(snapshot),pdf=Buffer.from('%PDF-1.7\nOriginal historical PDF\n%%EOF')
  db.prepare('INSERT INTO budget_versions(id,atendimento_id,sequence,label,created_at,snapshot,pdf,idempotency_key,request_hash)VALUES(?,?,?,?,?,?,?,?,?)').run(id,f.at.id,1,'A',old.createdAt,json,pdf,'historical-presentation-qa','qa')
  db.prepare('INSERT INTO budget_document_identity(serial,budget_version_id,filename)VALUES(99,?,?)').run(id,'Original.pdf')
  const saved=b.get(f.at.id,id);assert.equal(saved.snapshot.document!.data.diagnosticos[0]!.nome,'Para-lama · Passageiro');assert.deepEqual(b.pdf(f.at.id,id),pdf);assert.deepEqual(b.pdf(f.at.id,id),pdf)
  let sent:unknown
  await renderJsreportPdf(saved,frozenTerms(saved.snapshot),{endpoint:'https://renderer.invalid/api/report',username:'synthetic',password:'synthetic',template:'FUNIX - Orcamento'},async(_url,init)=>{sent=JSON.parse(String(init?.body));return new Response(new Uint8Array(pdf),{headers:{'Content-Type':'application/pdf'}})})
  assert.deepEqual(sent,{template:{name:'FUNIX - Orcamento'},data});assert.equal(db.prepare('SELECT snapshot FROM budget_versions WHERE id=?').get(id)!.snapshot,json);assert.deepEqual(b.pdf(f.at.id,id),pdf)
 }finally{db.close()}
})
