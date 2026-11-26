import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { AtendimentoRepository } from '../atendimentos.ts'
import { openDatabase } from '../database.ts'
import { handleSales, deadline } from '../erp/sales.ts'
import { recordConfirmedSalesContact } from '../erp/sales-events.ts'
import { FinanceRepository } from '../finance.ts'
import { handleWorkshop } from '../erp/workshop.ts'
import { ProductionRepository } from '../production.ts'
import { commercialFixture } from './fixtures/commercial.ts'
import { BudgetRepository } from './fixtures/budget-renderer.ts'
import type { FunnelCard, SalesMetric, TrackingCard } from '../../shared/sales.ts'

const start=Date.parse('2026-11-26T13:00:00.000Z')
const stamp=(minutes:number)=>new Date(start+minutes*60_000).toISOString()

function fixture() {
  const db=openDatabase(':memory:')
  const repo=new AtendimentoRepository(db)
  const request=(path:string,body?:unknown,minutes=0,query='')=>handleSales({db,path,method:body===undefined?'GET':'POST',query:new URLSearchParams(query),body,now:()=>start+minutes*60_000})
  const card=(id:string,minute=0)=> (request('/funnel',undefined,minute) as {cards:FunnelCard[]}).cards.find(c=>c.record.id===id)!
  return {db,repo,request,card}
}

test('Regras do Funil só usam atividade relevante e respeitam retorno programado',()=>{
  const {db,repo,request,card}=fixture()
  try {
    const record=repo.create({name:'Testador sintético',purpose:'commercial'})
    db.prepare('UPDATE atendimentos SET created_at=?,updated_at=? WHERE id=?').run(stamp(0),stamp(0),record.id)
    assert.equal(card(record.id,31).nextContactAt,stamp(30))
    assert.equal(card(record.id,31).overdue,true)
    repo.update(record.id,{name:'Nome revisado',revision:record.revision})
    assert.equal(card(record.id,31).lastActivityAt,stamp(0))
    // No receipt was recorded for failed sends, and an inbound legacy contact
    // event by itself cannot restart this clock.
    db.prepare('INSERT INTO chat_provider_conversations(id,instance,remote_jid) VALUES(?,?,?)').run('legacy-conversation','funix_comercial','5531999990101@s.whatsapp.net')
    db.prepare('INSERT INTO atendimento_contact_events VALUES(?,?,?,?)').run(record.id,'legacy-conversation','inbound',stamp(40))
    assert.equal(card(record.id,41).lastActivityAt,stamp(0))
    recordConfirmedSalesContact(db,record.id,'provider-out',stamp(42))
    recordConfirmedSalesContact(db,record.id,'provider-out',stamp(90))
    assert.equal(card(record.id,45).nextContactAt,stamp(72))
    db.prepare("UPDATE atendimentos SET stage='em-negociacao',updated_at=? WHERE id=?").run(stamp(50),record.id)
    assert.equal(card(record.id,51).nextContactAt,stamp(50+48*60))
    const route='/records/'+record.id
    const comment={requestId:'synthetic-comment',author:'Operador teste',comment:'Cliente pediu detalhes.'}
    request(route+'/comment',comment,55)
    request(route+'/comment',comment,60)
    assert.equal(card(record.id,60).lastActivityAt,stamp(55))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM erp_experience_diary').get()!.n,1)
    request(route+'/context',{owner:'Vendedor teste',channel:'WhatsApp',origin:'Indicação',nextContactAt:stamp(1440),nextAction:'Enviar atualização',additionalService:'',revision:0},60)
    assert.equal(card(record.id,90).nextContactAt,stamp(1440))
    assert.equal(card(record.id,1441).overdue,true)
    assert.equal((request('/funnel',undefined,90,'owner=Outra') as {cards:FunnelCard[]}).cards.length,0)
    assert.equal((request('/funnel',undefined,90,'owner=Vendedor+teste&channel=WhatsApp') as {cards:FunnelCard[]}).cards.length,1)
    assert.equal(deadline(stamp(0),null,null,start).nextContactAt,null)
  } finally {db.close()}
})

test('Atividade e ajuste de cadência alteram a urgência sem gravar datas fictícias',()=>{
  const {db,repo,request}=fixture()
  try {
    const first=repo.create({name:'Apresentação',purpose:'commercial'})
    const second=repo.create({name:'Primeiro no quadro',purpose:'commercial'})
    db.prepare('UPDATE atendimentos SET created_at=? WHERE id=?').run(stamp(0),first.id)
    db.prepare('UPDATE atendimentos SET created_at=? WHERE id=?').run(stamp(5),second.id)
    recordConfirmedSalesContact(db,first.id,'valid',stamp(25))
    request('/stages',{id:'novo-lead',label:'Contato novo',minutes:45})
    const result=request('/funnel',undefined,55) as {cards:FunnelCard[]}
    assert.deepEqual(result.cards.map(c=>[c.record.id,c.overdue]),[[second.id,true],[first.id,false]])
  } finally {db.close()}
})

test('Consentimento qualifica aprovação e projeta veículo agendado sem presumir presença ou quitação',async()=>{
  const {db,repo,request}=fixture()
  try {
    const sales=commercialFixture(db),at=sales.at.id
    const repoBudget=new BudgetRepository(db)
    const input={scenarioId:sales.scenario.id,negotiation:{mode:'none'} as const}
    const preview=repoBudget.preview(at,input)
    const version=await repoBudget.emit(at,{...input,previewToken:preview.token,idempotencyKey:randomUUID()})
    const production=new ProductionRepository(db,()=>start)
    const current=repo.get(at)
    const {experience}=production.schedule(at,{
      budgetIds:[version.id],scheduledEntry:'2026-11-27',deliveryDate:null,
      expectedAtendimentoRevision:current.revision,expectedExperienceRevision:null,
    })
    assert.ok(experience)
    const funnel=request('/funnel') as {cards:FunnelCard[]}
    assert.ok(!funnel.cards.some(c=>c.record.id===at))
    const tracking=request('/tracking') as {cards:TrackingCard[]}
    const [card]=tracking.cards
    assert.equal(card?.commercialPhase,'Agendado')
    assert.equal(card?.vehicle.present,false)
    assert.equal(card?.receivables,null)
    assert.equal(card?.vehicle.commercialClosedAt,null)
    const dashboard=request('/dashboard') as {metrics:SalesMetric[]}
    assert.deepEqual(dashboard.metrics.find(metric=>metric.label==='Vendas aprovadas')?.records,[at])
    assert.equal(dashboard.metrics.find(metric=>metric.label==='Experiências encerradas')?.value,'0')
    const finance=new FinanceRepository(db,()=>start)
    const title=randomUUID()
    finance.create({id:title,kind:'receivable',counterparty:'Cliente teste',description:'Serviço sintético',
      amountCents:2000,dueDate:'2026-11-30',experienceId:experience.id})
    finance.settle(title,{id:randomUUID(),amountCents:500,date:'2026-11-26'})
    let revision=card!.vehicle.revision
    for(const action of ['entry','phase','departure']) {
      const result=handleWorkshop({db,method:'POST',path:'/movement',query:new URLSearchParams(),now:()=>start,body:{
        action,experienceId:experience.id,requestId:randomUUID(),revision,operator:'Operador sintético',
        ...(action==='phase'?{phase:'finished',note:'Fases intermediárias dispensadas neste teste'}:{}),
      }}) as TrackingCard['vehicle']
      revision=result.revision
    }
    const afterDeparture=(request('/tracking') as {cards:TrackingCard[]}).cards[0]
    assert.equal(afterDeparture?.commercialPhase,'Fechamento')
    assert.equal(afterDeparture.vehicle.present,false)
    assert.equal(afterDeparture.receivables?.outstandingCents,1500)
    assert.equal(afterDeparture.receivables?.settledCents,500)
    assert.equal(afterDeparture.vehicle.commercialClosedAt,null)
    handleWorkshop({db,method:'POST',path:'/movement',query:new URLSearchParams(),now:()=>start,body:{
      action:'commercial-close',experienceId:experience.id,requestId:randomUUID(),revision,operator:'Operador sintético'
    }})
    assert.equal((request('/tracking') as {cards:TrackingCard[]}).cards.length,0)
    assert.equal((request('/dashboard') as {metrics:SalesMetric[]}).metrics.find(metric=>metric.label==='Experiências encerradas')?.value,'1')
    assert.equal(finance.overview().titles.find(row=>row.id===title)?.balanceCents,1500)
  } finally {db.close()}
})
