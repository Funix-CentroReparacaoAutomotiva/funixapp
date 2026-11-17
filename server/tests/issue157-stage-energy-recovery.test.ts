import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {planImport} from '../coda-import.ts'
import {TABLES,sourceId} from '../coda-import-source.ts'
import {codaFixture,table,set,ref} from './fixtures/coda-import.ts'
import type {CodaExport} from '../coda-import-source.ts'

/** Synthetic rows carrying the precise service/dimension/relation IDs audited in Coda.
 * No real customer rows, actual prices or live configuration are used.
 */
function caseFor(kind:'degrade'|'vidracaria'):CodaExport{
 const s=codaFixture(),glass=kind==='vidracaria'
 const serviceId=glass?'i-6v-u7Wk73b':'i-SW0n7TLbtf'
 const dimensionId=glass?'i-XAWXTYWQIa':'i-SW0n7TLbtf'
 const stageId=serviceId,relationId=glass?'i-5C_giBUwFs':'i-ekeOrRBJGn'
 const stageDimensionId='i-jTU8EBeCLM'
 const name=glass?'Vidraçaria':'Degradê'
 const service=table(s,TABLES.services).rows[0]!
 service.rowId=serviceId
 set(s,TABLES.services,'c-TvFH_jzZ3k',name)
 const dimension=table(s,TABLES.dimensions).rows[0]!
 dimension.rowId=dimensionId
 set(s,TABLES.dimensions,'c-TvFH_jzZ3k',ref(TABLES.services,serviceId))
 set(s,TABLES.dimensionNames,'c-FJw9NIz2cO',glass?'-':'P')
 const stage=table(s,TABLES.stages).rows[0]!
 stage.rowId=stageId
 set(s,TABLES.stages,'c-TvFH_jzZ3k',name)
 set(s,TABLES.stages,'c-96H1EFHFA1',ref('grid-ew1w2T2N9p',glass?'i-9eG6f0dpjb':'i-RkEIZ7Txjg'))
 const sd=table(s,TABLES.stageDimensions).rows[0]!
 sd.rowId=stageDimensionId
 set(s,TABLES.stageDimensions,'c-tb4TOqyqh7','Peça')
 set(s,TABLES.stageDimensions,'c-ufXqc_8vWI','')
 const relation=table(s,TABLES.relations).rows[0]!
 relation.rowId=relationId
 set(s,TABLES.relations,'c-7sr002IvYn',ref(TABLES.services,serviceId))
 set(s,TABLES.relations,'c-EBO2IBlQEH',ref(TABLES.dimensions,dimensionId))
 set(s,TABLES.relations,'c-AWrfBjSHDl',ref(TABLES.stages,stageId))
 set(s,TABLES.relations,'c-B9QLxROotP',glass?'':ref(TABLES.stageDimensions,stageDimensionId))
 const total=glass?3:5
 set(s,TABLES.energy,'c-3-8rupyDNx',total,0)
 set(s,TABLES.dimensions,'c-wZoGYfi40i',total)
 set(s,TABLES.relations,'c-Ii7Vzlr1ni',total)
 for(const target of s.tables){target.totalRows=target.rows.length;target.schema.rowCount=target.rows.length}
 return s
}
function planned(source:CodaExport){
 const db=openDatabase(':memory:')
 try{return planImport(db,source)}finally{db.close()}
}

for(const kind of ['degrade','vidracaria'] as const)test('#157: '+kind+' recupera uma etapa somente quando o total auditado comprova dimensão energética zero',()=>{
 const source=caseFor(kind),plan=planned(source)
 const serviceId=sourceId(TABLES.services,kind==='degrade'?'i-SW0n7TLbtf':'i-6v-u7Wk73b')
 const dimensionId=sourceId(TABLES.dimensions,kind==='degrade'?'i-SW0n7TLbtf':'i-XAWXTYWQIa')
 const relationId=sourceId(TABLES.relations,kind==='degrade'?'i-ekeOrRBJGn':'i-5C_giBUwFs')
 const dimension=plan.config.services.find(s=>s.serviceId===serviceId)!.dimensions.find(d=>d.dimensionId===dimensionId)!
 assert.equal(dimension.stages.length,1)
 assert.equal(dimension.stages[0]!.id,relationId)
 assert.equal(dimension.stages[0]!.baseEnergy,kind==='degrade'?'5':'3')
 assert.equal(dimension.stages[0]!.dimensionEnergy,'0')
 assert(plan.report.imported.some(x=>x.source===relationId && x.reason.includes('blank-zero')))
 assert(!plan.report.pending.some(x=>x.source===relationId&&x.reason.includes('energia')))
})

test('#157: divergência do total mantém a etapa bloqueada, sem fallback genérico',()=>{
 const source=caseFor('degrade')
 set(source,TABLES.relations,'c-Ii7Vzlr1ni',6)
 set(source,TABLES.dimensions,'c-wZoGYfi40i',6)
 const p=planned(source)
 assert.deepEqual(p.config.services[0]!.dimensions[0]!.stages,[])
 assert(p.report.pending.some(x=>x.reason.includes('Conjunto de etapas incompleto') || x.reason.includes('não liberado')))
})

test('#157: dimensão não auditada, mesmo com soma igual, não recebe zero implícito',()=>{
 const source=caseFor('degrade')
 table(source,TABLES.dimensions).rows[0]!.rowId='i-dim-nao-auditada'
 set(source,TABLES.relations,'c-EBO2IBlQEH',ref(TABLES.dimensions,'i-dim-nao-auditada'))
 const p=planned(source)
 assert.deepEqual(p.config.services[0]!.dimensions[0]!.stages,[])
})

test('#157: fórmula alterada bloqueia a recuperação mesmo com IDs e totais corretos',()=>{
 const source=caseFor('vidracaria')
 source.pricingFormulaSchema.columns=source.pricingFormulaSchema.columns.map(c=>c.columnId==='c-Ii7Vzlr1ni'?{...c,formula:'unverified'}:c)
 const p=planned(source)
 assert.deepEqual(p.config.services[0]!.dimensions[0]!.stages,[])
 assert(p.report.pending.some(x=>x.reason.includes('Conjunto de etapas incompleto')))
})

test('#157: energia dimensional negativa continua proibida, sem conversão nem liberação',()=>{
 const source=caseFor('degrade')
 set(source,TABLES.stageDimensions,'c-ufXqc_8vWI',ref(TABLES.energy,'i-synthetic-dimension-energy'))
 set(source,TABLES.energy,'c-3-8rupyDNx',-1,1)
 set(source,TABLES.relations,'c-Ii7Vzlr1ni',4)
 set(source,TABLES.dimensions,'c-wZoGYfi40i',4)
 const p=planned(source)
 assert.deepEqual(p.config.services[0]!.dimensions[0]!.stages,[])
 assert(p.report.pending.some(x=>x.reason.includes('negativa')))
})


test('#244: vitrificação de peça preserva energia 7 com adicional zero',()=>{
 const source=caseFor('degrade')
 const service='i-MC_Z0KK6Hn',dimension='i-8o9Z1Z6jtk',relation='i-Shnk4eSMZO',stage=service
 table(source,TABLES.services).rows[0]!.rowId=service
 set(source,TABLES.services,'c-TvFH_jzZ3k','Vitrificação')
 table(source,TABLES.dimensions).rows[0]!.rowId=dimension
 set(source,TABLES.dimensions,'c-TvFH_jzZ3k',ref(TABLES.services,service))
 set(source,TABLES.dimensionNames,'c-FJw9NIz2cO','Peça')
 table(source,TABLES.stages).rows[0]!.rowId=stage
 set(source,TABLES.stages,'c-TvFH_jzZ3k','Vitrificação')
 set(source,TABLES.stages,'c-96H1EFHFA1',ref('grid-ew1w2T2N9p','i-56WGZfFA7s'))
 table(source,TABLES.relations).rows[0]!.rowId=relation
 set(source,TABLES.relations,'c-7sr002IvYn',ref(TABLES.services,service))
 set(source,TABLES.relations,'c-EBO2IBlQEH',ref(TABLES.dimensions,dimension))
 set(source,TABLES.relations,'c-AWrfBjSHDl',ref(TABLES.stages,stage))
 set(source,TABLES.relations,'c-Ii7Vzlr1ni',7)
 set(source,TABLES.energy,'c-3-8rupyDNx',7,0)
 set(source,TABLES.dimensions,'c-wZoGYfi40i',7)
 const p=planned(source),d=p.config.services[0]!.dimensions[0]!
 assert.deepEqual(d.stages.map(x=>[x.id,x.baseEnergy,x.dimensionEnergy]),[[sourceId(TABLES.relations,relation),'7','0']])
 assert(p.report.imported.some(x=>x.reason.includes('blank-zero')))
})

function approvedPainting(kind:'pincelada'|'acessorios'){
 const source=codaFixture(),accessory=kind==='acessorios'
 const service='i-XDTMBmueos',dimension=accessory?'i-6Nx-kpDlH8':'i-6qb1FQ1krk'
 set(source,TABLES.services,'c-TvFH_jzZ3k','Pintura')
 table(source,TABLES.dimensions).rows[0]!.rowId=dimension
 set(source,TABLES.dimensions,'c-TvFH_jzZ3k',ref(TABLES.services,service))
 set(source,TABLES.dimensionNames,'c-FJw9NIz2cO',accessory?'Acessórios':'Pincelada')
 table(source,TABLES.stages).rows[0]!.rowId=service
 set(source,TABLES.stages,'c-TvFH_jzZ3k','Pintura')
 set(source,TABLES.stages,'c-96H1EFHFA1',ref('grid-ew1w2T2N9p','i-RkEIZ7Txjg'))
 const stageDim=accessory?'i-g8kG8I5f8m':'i-SUivHVlB1n'
 table(source,TABLES.stageDimensions).rows[0]!.rowId=stageDim
 set(source,TABLES.stageDimensions,'c-tb4TOqyqh7',accessory?'Acessórios':'Pincelada')
 const relation=accessory?'i-NXnon77Rne':'i-S_6NRwNdUK',original=accessory?7:1
 table(source,TABLES.relations).rows[0]!.rowId=relation
 set(source,TABLES.relations,'c-7sr002IvYn',ref(TABLES.services,service))
 set(source,TABLES.relations,'c-EBO2IBlQEH',ref(TABLES.dimensions,dimension))
 set(source,TABLES.relations,'c-AWrfBjSHDl',ref(TABLES.stages,service))
 set(source,TABLES.relations,'c-B9QLxROotP',ref(TABLES.stageDimensions,stageDim))
 set(source,TABLES.relations,'c-Ii7Vzlr1ni',original)
 set(source,TABLES.energy,'c-3-8rupyDNx',8,0)
 set(source,TABLES.energy,'c-3-8rupyDNx',accessory?-1:-7,1)
 set(source,TABLES.dimensions,'c-wZoGYfi40i',accessory?9:1)
 if(accessory){
  const finish='i-avxVYqUXNz',finishRelation='i-TBgYlc8UyX'
  const extraStage=structuredClone(table(source,TABLES.stages).rows[0]!)
  extraStage.rowId=finish;extraStage.values['c-TvFH_jzZ3k']={value:'Acabamento'}
  extraStage.values['c-K6LT-CKgWA']={value:ref(TABLES.energy,'i-synthetic-finish-energy')}
  table(source,TABLES.stages).rows.push(extraStage)
  table(source,TABLES.energy).rows.push({rowId:'i-synthetic-finish-energy',values:{'c-3-8rupyDNx':{value:3}}})
  const extra=structuredClone(table(source,TABLES.relations).rows[0]!)
  extra.rowId=finishRelation
  extra.values['c-AWrfBjSHDl']={value:ref(TABLES.stages,finish)}
  extra.values['c-Ii7Vzlr1ni']={value:2}
  table(source,TABLES.relations).rows.push(extra)
 }
 for(const t of source.tables){t.totalRows=t.rows.length;t.schema.rowCount=t.rows.length}
 return source
}
for(const kind of ['pincelada','acessorios'] as const)test('#157: Pintura '+kind+' preserva energia final com operandos não negativos',()=>{
 const source=approvedPainting(kind),p=planned(source),d=p.config.services[0]!.dimensions[0]!
 assert.deepEqual(d.stages.map(st=>st.baseEnergy),kind==='pincelada'?['1']:['7','2'])
 assert(d.stages.every(st=>st.dimensionEnergy==='0'))
 assert.equal(d.stages.reduce((a,st)=>a+Number(st.baseEnergy),0),kind==='pincelada'?1:9)
 assert(p.report.imported.some(x=>x.reason.includes('negative-normalized')))
})
test('#157: Pintura não aplica normalização se relação, base ou total divergirem',()=>{
 const source=approvedPainting('pincelada')
 set(source,TABLES.relations,'c-Ii7Vzlr1ni',2)
 set(source,TABLES.dimensions,'c-wZoGYfi40i',2)
 const p=planned(source)
 assert.deepEqual(p.config.services[0]!.dimensions[0]!.stages,[])
})
function polishM(){
 const s=codaFixture(),service='i-NG0WMuMSy1',dim='i-c5xaRttDXs'
 const stageDefs=[
 ['i-U2gB0INEA4','i-7AlfEsZwkv','Descontaminação',2,null],
 ['i-vFq1IPDC6U','i-ff8qEu9_LD','Corte',1,'i-g8kG8I5f8m'],
 ['i-5cH0Wlk0BH','i-x906J_jYhv','Refino',1,'i-g8kG8I5f8m'],
 ['i-4AHDqDWW7R','i-rRYmRgRJK2','Lustre',1,'i-g8kG8I5f8m']
 ] as const
 table(s,TABLES.services).rows[0]!.rowId=service
 set(s,TABLES.services,'c-TvFH_jzZ3k','Polimento')
 table(s,TABLES.dimensions).rows[0]!.rowId=dim
 set(s,TABLES.dimensions,'c-TvFH_jzZ3k',ref(TABLES.services,service))
 set(s,TABLES.dimensionNames,'c-FJw9NIz2cO','Veículo M')
 set(s,TABLES.dimensions,'c-wZoGYfi40i',5)
 table(s,TABLES.stageDimensions).rows[0]!.rowId='i-g8kG8I5f8m'
 set(s,TABLES.stageDimensions,'c-tb4TOqyqh7','Acessórios')
 set(s,TABLES.energy,'c-3-8rupyDNx',2,0)
 set(s,TABLES.energy,'c-3-8rupyDNx',-1,1)
 const originalStage=structuredClone(table(s,TABLES.stages).rows[0]!)
 const originalRel=structuredClone(table(s,TABLES.relations).rows[0]!)
 const stageRows=[],relRows=[]
 for(let i=0;i<stageDefs.length;i++){
  const [relationId,stageId,name,total,stageDimId]=stageDefs[i]!
  const st=structuredClone(originalStage),r=structuredClone(originalRel)
  st.rowId=stageId;st.values['c-TvFH_jzZ3k']={value:name}
  st.values['c-96H1EFHFA1']={value:ref('grid-ew1w2T2N9p','i-56WGZfFA7s')}
  r.rowId=relationId
  r.values['c-7sr002IvYn']={value:ref(TABLES.services,service)}
  r.values['c-EBO2IBlQEH']={value:ref(TABLES.dimensions,dim)}
  r.values['c-AWrfBjSHDl']={value:ref(TABLES.stages,stageId)}
  r.values['c-B9QLxROotP']={value:stageDimId?ref(TABLES.stageDimensions,stageDimId):''}
  r.values['c-Ii7Vzlr1ni']={value:total}
  r.values['c-oh6TT09I-z']={value:i+1}
  stageRows.push(st);relRows.push(r)
 }
 table(s,TABLES.stages).rows=stageRows
 table(s,TABLES.relations).rows=relRows
 for(const t of s.tables){t.totalRows=t.rows.length;t.schema.rowCount=t.rows.length}
 return s
}
test('#244: Polimento M respeita decisão 2+2+2+2=8 preservando os quatro IDs originais',()=>{
 const source=polishM(),p=planned(source),d=p.config.services[0]!.dimensions[0]!
 assert.equal(d.stages.length,4)
 assert.deepEqual(d.stages.map(st=>[st.baseEnergy,st.dimensionEnergy]),[['2','0'],['2','0'],['2','0'],['2','0']])
 assert.equal(d.stages.reduce((total,st)=>total+Number(st.baseEnergy),0),8)
 assert(p.report.imported.some(x=>x.reason.includes('polish-m')))
})
test('#244: Polimento M incompleto não libera três etapas parciais',()=>{
 const source=polishM()
 table(source,TABLES.relations).rows.pop()
 const t=table(source,TABLES.relations);t.totalRows=t.rows.length;t.schema.rowCount=t.rows.length
 const p=planned(source)
 assert.deepEqual(p.config.services[0]!.dimensions[0]!.stages,[])
 assert(p.report.pending.some(x=>x.reason.includes('Polimento Veículo M')))
})
