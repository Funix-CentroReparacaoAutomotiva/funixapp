import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../database.ts'
import {BudgetRepository} from '../budgets.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {toJsreportData,type JsreportTerms} from '../jsreport-adapter.ts'

const terms:JsreportTerms={
 prazoDiasUteis:'7',
 parcelamento:{
  tres:{valorParcela:'R$ 110,00',total:'R$ 330,00'},
  seis:{valorParcela:'R$ 56,00',total:'R$ 336,00'},
  nove:{valorParcela:'R$ 38,00',total:'R$ 342,00'},
  doze:{valorParcela:'R$ 29,00',total:'R$ 348,00'}
 }
}

test('jsreport receives the documented FUNIX structure from the frozen snapshot, with explicit terms only',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),budgets=new BudgetRepository(db)
  const saved=f.atendimentos.update(f.at.id,{revision:f.at.revision,plate:'QUM7553',name:'Pessoa QA',vehicle:'Carro QA'})
  assert.equal(saved.plate,'QUM7553')
  const payload={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
  const preview=budgets.preview(f.at.id,payload)
  const issued=budgets.emit(f.at.id,{...payload,previewToken:preview.token,idempotencyKey:randomUUID()})
  const data=toJsreportData(issued,terms)
  assert.deepEqual(Object.keys(data).sort(),['cliente','condicoes','diagnosticos','financeiro','meta','parcelamento','veiculo'])
  assert.equal(data.meta.id,'OR-000001')
  assert.equal(data.cliente.nome,'Pessoa QA')
  assert.equal(data.veiculo.placa,'QUM7553')
  assert.equal(data.financeiro.totalVista,'R$300,15')
  assert.equal(data.condicoes.prazo,'7')
  assert.deepEqual(data.parcelamento,terms.parcelamento)
  assert.equal(data.diagnosticos[0]?.clusters[0]?.tipo,'servico')
  assert.equal(data.diagnosticos[0]?.clusters[0]?.valor,'R$300,15')
  assert.throws(()=>toJsreportData(issued,{...terms,prazoDiasUteis:''}),/Prazo/)
  assert.throws(()=>toJsreportData(issued,{...terms,parcelamento:{...terms.parcelamento,doze:{valorParcela:'',total:''}}}),/parcelamento/)
 }finally{db.close()}
})

test('jsreport adapter always reads the issued snapshot, not a subsequently changed vehicle',()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db),budgets=new BudgetRepository(db)
  const payload={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
  const preview=budgets.preview(f.at.id,payload)
  const v=budgets.emit(f.at.id,{...payload,previewToken:preview.token,idempotencyKey:randomUUID()})
  const original=toJsreportData(v,terms)
  f.atendimentos.update(f.at.id,{revision:f.at.revision,plate:'ABC0000'})
  assert.deepEqual(toJsreportData(budgets.get(f.at.id,v.id),terms),original)
 }finally{db.close()}
})
