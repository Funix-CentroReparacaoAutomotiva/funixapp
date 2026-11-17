import test from 'node:test'
import assert from 'node:assert/strict'
import {historicalCodaColumns as c,historicalCodaTables as t,normalizeHistoricalCodaCapture} from '../historical-coda-capture.ts'

const id=(s:string)=>'i-synthetic-'+s
const ref=(s:string,table:string,name:string)=>({type:'ref',rowId:id(s),targetTableId:table,name})
const currency=(scalar:number)=>({type:'currency',code:'BRL',scalar})
function row(rowId:string,columns:Record<string,string>,fields:Record<string,unknown>){
  return {rowId:id(rowId),values:Object.fromEntries(Object.entries(fields).map(([key,value])=>[columns[key],{value}]))}
}
function table(tableId:string,rows:ReturnType<typeof row>[]){return {tableId,pages:[{offset:0,rows,totalRows:rows.length,hasMore:false}]}}
function capture(){
  const budget='SYNTHETIC-BUDGET',diag=budget+'_A',service=diag+'_SA.1'
  return {format:'funix-historical-coda-capture-v1',documentId:'2zsjI-nqWr',tables:{
    budget:table(t.budget,[row('budget',c.budget,{number:budget,attendance:ref('at',t.attendance,'AT-SYNTHETIC'),status:ref('status','grid-synthetic-status','Consentido'),date:{type:'dt',epoch:1767225600},days:7,color:'',risk:'',pricing:'Padrão',services:currency(100),netServices:currency(99.99999999999999),parts:currency(120.00000000000001),discount:currency(1e-13),total:currency(220),beforeDiscount:currency(220),diagnosisRefs:[ref('diag',t.diagnoses,diag)],serviceRefs:[ref('service',t.services,service)],componentRefs:[ref('component',t.components,'Item fictício')],p3:77.73333333333333,t3:233.2,p6:'',t6:'',p9:'',t9:'',p12:'',t12:''})]),
    attendance:table(t.attendance,[row('at',c.attendance,{number:'AT-SYNTHETIC'})]),
    diagnoses:table(t.diagnoses,[row('diag',c.diagnoses,{budget,id:diag,code:'A',piece:'Peça fictícia',position:'Dianteiro',damage:'Riscado',summary:'Riscado (Moderado)',services:currency(100),parts:currency(120)})]),
    services:table(t.services,[row('service',c.services,{budget,id:service,parent:diag,code:'A.1',name:'Pintura',dimension:'Completa',quantity:1,unit:currency(100),total:currency(100),energy:3})]),
    components:table(t.components,[row('component',c.components,{budget,parent:diag,code:'A.i',name:'Item fictício',quantity:1,unit:currency(120),total:currency(120)})]),
    stages:table(t.stages,[1,2,3].map(n=>row('stage'+n,c.stages,{budget,parent:diag,id:service+'_E'+(n===3?2:n),code:'A.1.'+(n===3?2:n),service:'Pintura',name:'Etapa '+n,energy:1,amount:currency(100/3),category:{type:'slate',root:{children:[{children:[{text:'Preparação técnica'}]}]}}}))),
  }}
}
test('connector normalization uses exact source parents, amounts and distinct physical stages',()=>{
  const a=capture(),b=structuredClone(a)
  b.tables.stages.pages[0]!.rows.reverse()
  const p=normalizeHistoricalCodaCapture(a,b)
  assert.equal(p.financialIntegrity,true)
  assert.equal(p.data.totals.discount,'0.00')
  assert.equal(p.calculated.total,'220')
  assert.equal(p.data.stages.length,3)
  assert.equal(p.data.diagnoses[0]!.intensity,'Moderado')
  assert.equal(p.data.installments[0]!.amount,'77.73')
  assert.ok(p.warnings.some(x=>x.code==='DUPLICATE_STAGE_CODE'))
})
test('rejects incomplete captures, incompatible parents, ambiguous source linkage and changed reads',()=>{
  const a=capture(),missing=capture(),changed=capture(),wrong=capture(),duplicate=capture()
  missing.tables.stages.pages[0]!.totalRows++
  assert.throws(()=>normalizeHistoricalCodaCapture(missing,missing),{code:'HISTORICAL_CODA_CAPTURE_INVALID'})
  wrong.tables.stages.pages[0]!.rows[0]!.values[c.stages.parent]={value:'other'}
  assert.throws(()=>normalizeHistoricalCodaCapture(wrong,wrong),{code:'HISTORICAL_CODA_CAPTURE_INVALID'})
  duplicate.tables.budget.pages[0]!.rows.push(structuredClone(duplicate.tables.budget.pages[0]!.rows[0]!))
  duplicate.tables.budget.pages[0]!.totalRows++
  assert.throws(()=>normalizeHistoricalCodaCapture(duplicate,duplicate),{code:'HISTORICAL_CODA_CAPTURE_INVALID'})
  changed.tables.budget.pages[0]!.rows[0]!.values[c.budget.days]={value:8}
  assert.throws(()=>normalizeHistoricalCodaCapture(a,changed),{code:'HISTORICAL_CODA_CAPTURE_CHANGED'})
})
test('fails closed on a mismatched budget relation or non-cent monetary source',()=>{
  const a=capture(),b=capture()
  a.tables.budget.pages[0]!.rows[0]!.values[c.budget.serviceRefs]={value:[]}
  assert.throws(()=>normalizeHistoricalCodaCapture(a,a),{code:'HISTORICAL_CODA_CAPTURE_INVALID'})
  b.tables.components.pages[0]!.rows[0]!.values[c.components.unit]={value:currency(120.003)}
  assert.throws(()=>normalizeHistoricalCodaCapture(b,b),{code:'HISTORICAL_CODA_CAPTURE_INVALID'})
})
