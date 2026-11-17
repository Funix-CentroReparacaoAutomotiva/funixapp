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
 assert(plan.report.imported.some(x=>x.source===relationId && x.reason.includes('demonstrada')))
 assert(!plan.report.pending.some(x=>x.source===relationId&&x.reason.includes('energia')))
})

test('#157: divergência do total mantém a etapa bloqueada, sem fallback genérico',()=>{
 const source=caseFor('degrade')
 set(source,TABLES.relations,'c-Ii7Vzlr1ni',6)
 set(source,TABLES.dimensions,'c-wZoGYfi40i',6)
 const p=planned(source)
 assert.deepEqual(p.config.services[0]!.dimensions[0]!.stages,[])
 assert(p.report.pending.some(x=>x.reason.includes('Energia inválida')))
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
