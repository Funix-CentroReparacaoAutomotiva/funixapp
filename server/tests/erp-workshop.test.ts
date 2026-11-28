import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { workshopPhases } from '../../shared/erp.ts'
import type { TrackingCard } from '../../shared/sales.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { openDatabase } from '../database.ts'
import { handleSales } from '../erp/sales.ts'
import { handleWorkshop, listWorkshopVehicles, migrateWorkshop } from '../erp/workshop.ts'
import { ServiceError } from '../errors.ts'
import { ProductionRepository } from '../production.ts'
import { BudgetRepository } from './fixtures/budget-renderer.ts'
import { commercialFixture } from './fixtures/commercial.ts'
import { identifyForProduction, scheduleInput } from './fixtures/production.ts'

const instant = Date.parse('2026-11-27T12:00:00Z')
type Db = ReturnType<typeof openDatabase>
type Yard = {vehicles:ReturnType<typeof listWorkshopVehicles>;today:string}
type Plan = {sourceId:string;revision:number;actualStart:string|null;energy:string;sourceChanged:boolean}
type Planning = {
  days:{day:string;holiday:boolean;weekend:boolean}[]
  sources:{id:string;stageId:string;energy:string|null;phase:string|null}[]
  plans:Plan[]
  capacity:{days:{day:string;capacity:string;planned:string;overloaded:boolean;percent:string|null}[]}[]
}
const code = (status:number) => (error:unknown) => error instanceof ServiceError && error.status === status
function context(db:Db) {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='erp_workshop_events'").get()) migrateWorkshop(db)
  return <T = unknown>(path:string, body?:unknown, now=instant): T => {
    const [route, search] = path.split('?')
    return handleWorkshop({db,path:route!,method:body===undefined ? 'GET' : 'POST',
      query:new URLSearchParams(search),body,now:()=>now}) as T
  }
}
function schedule(db:Db, plate:string, inOperation=false) {
  const at = new AtendimentoRepository(db).create({plate,name:'Cliente sintético'})
  const id = randomUUID()
  db.prepare(`INSERT INTO production_experiences
    (id,atendimento_id,customer_json,vehicle_json,payer_json,scheduled_entry,created_at,updated_at,in_operation)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id,at.id,'{"text":"Cliente sintético"}',
      JSON.stringify({text:'Modelo sintético',plate}),'{"text":"Pagador sintético"}',
      '2026-11-20T10:00','2026-11-19T00:00:00Z','2026-11-19T00:00:00Z',Number(inOperation))
  return id
}

test('Pátio separa agendamento, presença, impedimento, saída e fechamento financeiro/comercial', () => {
  const db = openDatabase(':memory:')
  try {
    const call = context(db), experienceId = schedule(db,'QA00001',true)
    const unplated = schedule(db,'')
    const original = call<Yard>('/yard').vehicles.find(item => item.experienceId===experienceId)!
    assert.equal(original.present,false)
    assert.equal(original.requiresClassification,true)
    assert.equal(original.phase,'scheduled')
    const send = (action:string, revision:number, fields:Record<string,unknown>={}) =>
      call<Yard['vehicles'][number]>('/movement',{experienceId,action,revision,operator:'Equipe sintética',requestId:randomUUID(),...fields})
    assert.throws(() => send('departure',0),code(422))
    assert.throws(() => send('commercial-close',0),code(422))
    assert.throws(() => send('entry',0,{experienceId:unplated}),code(422))
    const requestId = randomUUID()
    const entered = send('entry',0,{requestId})
    assert.equal(entered.present,true)
    assert.equal(entered.phase,'entry-inspection')
    assert.deepEqual(send('entry',0,{requestId}),entered)
    assert.throws(() => send('entry',0,{requestId,note:'Outra entrada'}),code(409))
    assert.throws(() => send('phase',0,{phase:'disassembly'}),code(409))
    const blocked = send('block',entered.revision,{note:'Peça pendente'})
    assert.equal(blocked.phase,entered.phase)
    assert.equal(blocked.blocked,true)
    assert.throws(() => send('phase',blocked.revision,{phase:'disassembly'}),code(422))
    const quality = send('quality',blocked.revision,{note:'Qualidade registrada'})
    const unblocked = send('unblock',quality.revision,{note:'Peça recebida'})
    assert.throws(() => send('phase',unblocked.revision,{phase:'finished'}),code(422))
    const finished = send('phase',unblocked.revision,{phase:'finished',note:'Demais etapas não se aplicam ao serviço'})
    assert.equal(finished.present,true)
    const departed = send('departure',finished.revision)
    assert.equal(departed.present,false)
    assert.equal(departed.commercialClosedAt,null)
    assert.equal(departed.phase,'departed')
    assert.equal(call<Yard>('/yard',undefined,instant + 86400000).vehicles.some(vehicle => vehicle.experienceId===experienceId),false)
    assert.equal(db.prepare('SELECT in_operation FROM production_experiences WHERE id=?').get(experienceId)!.in_operation,0)
    assert.ok(send('commercial-close',departed.revision).commercialClosedAt)
    const history = call<{events:{action:string}[]}>('/history?experienceId='+experienceId).events
    assert.deepEqual(history.map(event=>event.action),['commercial-close','departure','phase','unblock','quality','block','entry'])
    assert.equal(workshopPhases.length,12)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  } finally {db.close()}
})

test('Planejamento usa escopo autorizado, conserva energia, histórico e datas realizadas', async () => {
  const db = openDatabase(':memory:')
  try {
    const call = context(db), fixture = commercialFixture(db), production = new ProductionRepository(db,()=>instant)
    identifyForProduction(db,fixture.at.id)
    const budgets = new BudgetRepository(db)
    const input = {scenarioId:fixture.scenario.id,negotiation:{mode:'none'} as const}
    const issued = await budgets.emit(fixture.at.id,{...input,previewToken:budgets.preview(fixture.at.id,input).token,idempotencyKey:randomUUID()})
    const complement = await budgets.emit(fixture.at.id,{...input,previewToken:budgets.preview(fixture.at.id,input).token,idempotencyKey:randomUUID()})
    production.schedule(fixture.at.id,scheduleInput(db,fixture.at.id,[issued.id,complement.id]))
    assert.equal(call<Planning>('/planning').sources.length,0)
    production.authorize(fixture.at.id,issued.id,{confirmed:true})
    production.authorize(fixture.at.id,complement.id,{confirmed:true})
    const configured = call<Planning>('/planning')
    const [first,second] = configured.sources
    assert.equal(first?.energy,'15')
    assert.equal(first?.phase,null)
    const start = '2026-11-23', end = '2026-11-25'
    const plan = {sourceId:first!.id,resourceId:'resource',start,end,priority:100,revision:0}
    assert.throws(() => call('/planning/segment',plan),code(422))
    call('/planning/setup',{action:'mapping',stageId:first!.stageId,phase:'preparation'})
    call('/planning/setup',{action:'resource',id:'resource',name:'Equipe sintética',dailyEnergy:'4',exclusive:false})
    call('/planning/setup',{action:'holiday',day:'2026-11-24',name:'Feriado sintético'})
    assert.throws(() => call('/planning/segment',{...plan,end:'2026-11-24'}),code(422))
    assert.equal(call<Plan>('/planning/segment',plan).revision,1)
    assert.throws(() => call('/planning/segment',{...plan,sourceId:second!.id,predecessor:first!.id}),code(422))
    const dependent = {...plan,sourceId:second!.id,predecessor:first!.id,start:'2026-11-26',end:'2026-11-26'}
    assert.equal(call<Plan>('/planning/segment',dependent).revision,1)
    assert.throws(() => call('/planning/segment',{...plan,revision:1,end:dependent.start}),code(422))
    const schedule = call<Planning>('/planning?start=2026-11-23&days=7')
    assert.equal(schedule.days[1]?.holiday,true)
    assert.equal(schedule.days[5]?.weekend,true)
    const days = schedule.capacity[0]!.days
    assert.deepEqual(days.slice(0,3).map(day=>[day.planned,day.capacity,day.percent,day.overloaded]),
      [['7.5','4','188',true],['0','0',null,false],['7.5','4','188',true]])
    assert.equal(call<Plan>('/planning/segment',{action:'actual',sourceId:first!.id,revision:1,actualStart:start}).actualStart,start)
    assert.equal(call<Plan>('/planning/segment',{...plan,revision:2,priority:1}).actualStart,start)
    assert.throws(() => call('/planning/segment',plan),code(409))
    const history = call<{events:{action:string}[]}>('/planning/history?sourceId='+encodeURIComponent(first!.id))
    assert.deepEqual(history.events.map(event=>event.action),['plan','actual','plan'])
    call('/planning/setup',{action:'resource',id:'resource',name:'Equipe sintética',dailyEnergy:'4',exclusive:true})
    assert.throws(() => call('/planning/segment',{...dependent,predecessor:null,revision:1,start,end}),code(409))
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  } finally {db.close()}
})

test('Correspondências e cores são compartilhadas entre Pátio, Planejamento e Acompanhamento', () => {
  const db = openDatabase(':memory:')
  try {
    const call = context(db), experienceId = schedule(db,'QA00001')
    type Phase = {id:string;commercial:string;tone:string}
    const settings = call<{phases:Phase[];revision:string}>('/phase-mapping')
    const correspondences = settings.phases.filter(item => item.id !== 'scheduled' && item.id !== 'departed')
      .map(item => ({phase:item.id,commercial:item.id === 'entry-inspection' ? 'Acabamento' : item.commercial}))
    assert.throws(() => call('/phase-mapping',{revision:settings.revision,correspondences:[
      ...correspondences.slice(1),{phase:'scheduled',commercial:'Acabamento'},
    ]}),code(422))
    call('/phase-mapping',{revision:settings.revision,correspondences})
    assert.throws(() => call('/phase-mapping',{revision:settings.revision,correspondences}),code(409))
    call('/movement',{experienceId,requestId:randomUUID(),revision:0,action:'entry',operator:'QA'})
    for (const route of ['/yard','/planning']) {
      const phase = call<{phases:Phase[]}>(route).phases.find(item => item.id === 'entry-inspection')!
      assert.equal(phase.commercial,'Acabamento')
      assert.equal(phase.tone,'orange')
    }
    const tracking = handleSales({db,path:'/tracking',method:'GET',query:new URLSearchParams(),body:undefined,
      now:()=>instant}) as {cards:TrackingCard[]}
    assert.equal(tracking.cards[0]?.commercialPhase,'Acabamento')
    assert.equal(tracking.cards[0]?.tone,'orange')
    assert.equal(tracking.cards[0]?.vehicle.phase,'entry-inspection')
  } finally {db.close()}
})
