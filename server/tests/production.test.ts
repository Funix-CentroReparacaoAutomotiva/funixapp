import assert from 'node:assert/strict'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Worker} from 'node:worker_threads'
import {AtendimentoRepository} from '../atendimentos.ts'
import {BudgetCancellationRepository} from '../budget-cancellations.ts'
import {openDatabase} from '../database.ts'
import {ServiceError} from '../errors.ts'
import {migrate} from '../migrations.ts'
import {ProductionRepository} from '../production.ts'
import {WorkOrderRepository} from '../work-orders.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {BudgetRepository} from './fixtures/budget-renderer.ts'
import {identifyForProduction,legacyOrder,removeV24FixtureSchema,scheduleInput} from './fixtures/production.ts'

const code=(name:string)=>(error:unknown)=>error instanceof ServiceError && error.code===name
const instant=Date.parse('2026-11-18T11:45:00Z')
type Db=ReturnType<typeof openDatabase>

function emit(budgets:BudgetRepository,at:string,scenarioId:string) {
  const input={scenarioId,negotiation:{mode:'none'} as const}
  const preview=budgets.preview(at,input)
  return budgets.emit(at,{...input,previewToken:preview.token,idempotencyKey:randomUUID()})
}

async function issued(db:Db, count:number) {
  const f=commercialFixture(db), budgets=new BudgetRepository(db), versions=[]
  for(let index=0;index<count;index++)versions.push(await emit(budgets,f.at.id,f.scenario.id))
  return {at:f.at.id, budgets, versions}
}

test('Agendamento múltiplo e complementos compartilham a Experiência, com rastreio e documentos preservados',async()=>{
  const db=openDatabase(':memory:')
  try{
    const {at,budgets,versions}=await issued(db,4)
    const [first,second,complement,unselected]=versions.map(version=>version.id) as [string,string,string,string]
    const pdf=budgets.pdf(at,first), snapshot=budgets.get(at,first)
    identifyForProduction(db,at)
    const production=new ProductionRepository(db,()=>instant)
    assert.throws(()=>production.authorize(at,first,{confirmed:true}),code('BUDGET_CONSENT_REQUIRED'))
    const original={...scheduleInput(db,at,[first,second]),deliveryDate:'2026-11-28'}
    const scheduled=production.schedule(at,original)
    assert.ok(scheduled.experience)
    assert.equal(scheduled.experience.deliveryDate,'2026-11-28')
    assert.equal(scheduled.budgets.find(b=>b.id===unselected)?.state,'negotiating')
    assert.equal(db.prepare('SELECT count(*) n FROM work_orders').get()!.n,0)
    assert.deepEqual(production.schedule(at,original),scheduled)
    const rescheduled=production.schedule(at,{...scheduleInput(db,at,[]),scheduledEntry:'2026-11-21T11:00'})
    assert.equal(rescheduled.experience?.id,scheduled.experience.id)
    assert.equal(rescheduled.experience?.revision,2)
    assert.throws(()=>production.schedule(at,original),code('SCHEDULE_CONFLICT'))
    const receipt=production.authorize(at,first,{confirmed:true})
    assert.equal(receipt.experienceId,scheduled.experience.id)
    assert.deepEqual(production.authorize(at,first,{confirmed:true}),receipt)
    const technical=production.reject(at,second,'technical',{reason:'Escopo não executável'})
    assert.equal(technical.budgets.find(b=>b.id===second)?.state,'rejected')
    assert.deepEqual(production.reject(at,second,'technical',{reason:'Escopo não executável'}),technical)
    assert.throws(()=>production.reject(at,second,'technical',{reason:'Outro motivo'}),code('BUDGET_REJECTION_CONFLICT'))
    assert.throws(()=>production.authorize(at,second,{confirmed:true}),code('BUDGET_CONSENT_REQUIRED'))
    assert.throws(()=>production.reject(at,first,'technical',{reason:'Motivo sintético'}),code('BUDGET_REJECTION_CONFLICT'))
    production.reject(at,unselected,'commercial',{reason:'Recusa expressa do cliente'})
    assert.throws(()=>production.schedule(at,scheduleInput(db,at,[unselected])),code('BUDGET_NOT_SCHEDULABLE'))
    const next=production.schedule(at,scheduleInput(db,at,[complement]))
    assert.equal(next.experience?.id,scheduled.experience.id)
    const extra=production.authorize(at,complement,{confirmed:true})
    assert.equal(extra.experienceId,scheduled.experience.id)
    assert.notEqual(extra.number,receipt.number)
    assert.equal(db.prepare('SELECT count(*) n FROM work_orders').get()!.n,2)
    assert.deepEqual(production.get(at).budgets.find(b=>b.id===first)?.history,[
      {from:'negotiating',to:'consented',origin:'commercial',occurredAt:new Date(instant).toISOString(),
        reason:null,actorSource:'authenticated-session-confirmation',operatorId:null},
      {from:'consented',to:'authorized',origin:'technical',occurredAt:new Date(instant).toISOString(),
        reason:null,actorSource:'authenticated-session-confirmation',operatorId:null},
    ])
    assert.equal(production.get(at).budgets.find(b=>b.id===unselected)?.history[0]?.origin,'commercial')
    assert.equal(production.get(at).budgets.find(b=>b.id===second)?.history.at(-1)?.origin,'technical')
    assert.deepEqual(budgets.get(at,first),snapshot)
    assert.deepEqual(budgets.pdf(at,first),pdf)
    const cancel=new BudgetCancellationRepository(db)
    cancel.cancel(at,first,{reason:'Cancelamento sintético'})
    cancel.cancel(at,first,{})
    const history=production.get(at).budgets.find(b=>b.id===first)?.history
    assert.equal(history?.length,3)
    assert.equal(history?.at(-1)?.from,'authorized')
    assert.equal(history?.at(-1)?.to,'cancelled')
    assert.throws(()=>production.authorize(at,first,{confirmed:true}),code('BUDGET_CANCELLED'))
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')
  }finally{db.close()}
})

test('Guarda de integridade, revisão concorrente e rollback em falhas durante agendamento e emissão',async()=>{
  const db=openDatabase(':memory:')
  try{
    const {at,versions}=await issued(db,2)
    const [first,second]=versions.map(version=>version.id) as [string,string]
    const other=new AtendimentoRepository(db).create({phone:'987',name:'Outro cliente sintético'})
    const production=new ProductionRepository(db)
    identifyForProduction(db,at)
    const body=scheduleInput(db,at,[first,second])
    assert.throws(()=>production.schedule(at,{...body,budgetIds:[]}),code('SCHEDULE_BUDGET_REQUIRED'))
    assert.throws(()=>production.schedule(at,{...body,budgetIds:[first,first]}),code('INVALID_SCHEDULE_BUDGETS'))
    assert.throws(()=>production.schedule(at,{...body,parties:{...body.parties,payer:{id:null,text:'Não relacionado'}}}),code('SCHEDULE_PARTIES_CONFLICT'))
    assert.throws(()=>production.schedule(other.id,body),code('NOT_FOUND'))
    assert.throws(()=>db.prepare(`INSERT INTO production_budget_transitions
      (atendimento_id,budget_version_id,previous_state,state,origin,occurred_at,reason)
      VALUES(?,?,'negotiating','rejected','commercial','synthetic','Teste de chave composta')`).run(other.id,first),/FOREIGN KEY/)
    assert.throws(()=>legacyOrder(db,versions[0]!),/requires technical authorization/)
    db.exec(`CREATE TRIGGER synthetic_fail_consent BEFORE INSERT ON production_budget_transitions
      WHEN NEW.budget_version_id='${second}' BEGIN SELECT RAISE(ABORT,'synthetic scheduling failure'); END`)
    assert.throws(()=>production.schedule(at,{...body,deliveryDate:'2026-12-05'}),/synthetic scheduling failure/)
    assert.equal(production.get(at).experience,null)
    assert.equal(production.get(at).deliveryDate,null)
    assert(production.get(at).budgets.every(b=>b.state==='negotiating'&&b.history.length===0))
    assert.equal(db.prepare('SELECT count(*) n FROM atendimento_delivery_date_history').get()!.n,0)
    db.exec('DROP TRIGGER synthetic_fail_consent')
    const result=production.schedule(at,body)
    db.exec("CREATE TRIGGER synthetic_fail_os BEFORE INSERT ON work_orders BEGIN SELECT RAISE(ABORT,'synthetic OS failure'); END")
    assert.throws(()=>production.authorize(at,first,{confirmed:true}),/synthetic OS failure/)
    assert.deepEqual(production.get(at),result)
    db.exec('DROP TRIGGER synthetic_fail_os')
    production.authorize(at,first,{confirmed:true})
    db.prepare(`INSERT INTO production_experiences
      (id,atendimento_id,customer_json,vehicle_json,payer_json,scheduled_entry,created_at,updated_at)
      SELECT 'other-experience',?,customer_json,vehicle_json,payer_json,scheduled_entry,created_at,updated_at
      FROM production_experiences WHERE atendimento_id=?`).run(other.id,at)
    assert.throws(()=>db.prepare(`INSERT INTO work_orders(id,atendimento_id,budget_version_id,created_at,authorized_at,
      authorization_source,budget_number,budget_label,scope_json,experience_id)
      SELECT 'wrong-order',atendimento_id,?,created_at,authorized_at,authorization_source,budget_number,budget_label,scope_json,
      'other-experience' FROM work_orders WHERE budget_version_id=?`).run(second,first),/requires technical authorization/)
    assert.throws(()=>db.prepare("UPDATE production_budget_transitions SET reason='altered'").run(),/immutable/)
    assert.throws(()=>db.prepare("UPDATE production_experiences SET vehicle_json='{}'").run(),/immutable/)
    assert.throws(()=>db.prepare("UPDATE production_experiences SET id='changed'").run(),/immutable/)
    assert.throws(()=>db.prepare(`INSERT INTO production_budget_transitions
      (atendimento_id,budget_version_id,previous_state,state,origin,occurred_at)
      VALUES(?,?,'consented','executed','technical','synthetic')`).run(at,second),/Invalid budget lifecycle/)
  }finally{db.close()}
})

test('Agendamento rejeita cliente ou placa de outra referência e reverte o lote inteiro',async()=>{
  const db=openDatabase(':memory:')
  try{
    const f=commercialFixture(db), at=f.at.id, budgets=new BudgetRepository(db)
    const who={id:null,text:f.at.name}, other={id:null,text:'Outro cliente sintético'}
    const carA={id:null,text:'Mesmo modelo sintético',plate:'SYN1A01',modelYear:'2023'}
    const carB={...carA,plate:'SYN1B02'}
    const missingPlate={...carA,plate:''}, differentYear={...carA,modelYear:'2024'}
    const payer=[{id:null,text:'Pagador sintético'}]
    const setReferences=(vehicle:typeof carA[])=>{
      const record=f.atendimentos.get(at,true)
      f.atendimentos.update(at,{revision:record.revision,references:{
        ...record.references!,person:[who,other],vehicle,payer,
      }})
    }
    setReferences([carA,carB])
    const first=await emit(budgets,at,f.scenario.id)
    setReferences([carB,carA,missingPlate,differentYear])
    const second=await emit(budgets,at,f.scenario.id)
    const production=new ProductionRepository(db)
    const schedule=scheduleInput(db,at,[first.id,second.id])
    const toA={...schedule,deliveryDate:'2026-11-24',parties:{...schedule.parties,vehicle:carA}}
    const original=production.get(at)
    assert.throws(()=>production.schedule(at,toA),code('BUDGET_IDENTITY_CONFLICT'))
    assert.deepEqual(production.get(at),original)
    const toB={...schedule,budgetIds:[first.id]}
    assert.throws(()=>production.schedule(at,toB),code('BUDGET_IDENTITY_CONFLICT'))
    const forFirst={...toA,budgetIds:[first.id]}
    assert.throws(()=>production.schedule(at,{...forFirst,parties:{...forFirst.parties,customer:other}}),code('BUDGET_IDENTITY_CONFLICT'))
    for(const vehicle of [missingPlate,differentYear])
      assert.throws(()=>production.schedule(at,{...forFirst,parties:{...forFirst.parties,vehicle}}),code('BUDGET_IDENTITY_CONFLICT'))
    assert.deepEqual(production.get(at),original)
    assert.equal(production.schedule(at,forFirst).experience?.vehicle.plate,carA.plate)
    assert.throws(()=>production.schedule(at,scheduleInput(db,at,[second.id])),code('BUDGET_IDENTITY_CONFLICT'))
    const order=production.authorize(at,first.id,{confirmed:true})
    assert.equal(order.scope.vehicle.plate,carA.plate)
    assert.equal(production.get(at).budgets.find(b=>b.id===second.id)?.state,'negotiating')
  }finally{db.close()}
})

test('Autorização bloqueia consentimento incompatível gravado pela revisão anterior',async()=>{
  const db=openDatabase(':memory:')
  try{
    const {at,budgets,versions}=await issued(db,1), version=versions[0]!
    const record=identifyForProduction(db,at)
    new AtendimentoRepository(db).update(at,{revision:record.revision,plate:'SYN1B02'})
    const production=new ProductionRepository(db)
    // Reproduce the consent recorded by the previous implementation.
    const {parties,scheduledEntry}=scheduleInput(db,at,[version.id])
    const now=new Date(instant).toISOString()
    db.prepare(`INSERT INTO production_experiences
      (id,atendimento_id,customer_json,vehicle_json,payer_json,scheduled_entry,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(),at,JSON.stringify(parties.customer),
        JSON.stringify(parties.vehicle),JSON.stringify(parties.payer),scheduledEntry,now,now)
    db.prepare(`INSERT INTO production_budget_transitions
      (atendimento_id,budget_version_id,previous_state,state,origin,occurred_at)
      VALUES(?,?,'negotiating','consented','commercial',?)`).run(at,version.id,now)
    const before=production.get(at), pdf=budgets.pdf(at,version.id)
    assert.throws(()=>production.authorize(at,version.id,{confirmed:true}),code('BUDGET_IDENTITY_CONFLICT'))
    assert.deepEqual(production.get(at),before)
    assert.equal(db.prepare('SELECT count(*) n FROM work_orders').get()!.n,0)
    assert.deepEqual(budgets.get(at,version.id),version)
    assert.deepEqual(budgets.pdf(at,version.id),pdf)
  }finally{db.close()}
})

test('Identificação ausente pode ser completada e dados já emitidos mantêm a grafia original na OS',async()=>{
  const db=openDatabase(':memory:')
  try{
    const f=commercialFixture(db),at=f.at.id,budgets=new BudgetRepository(db)
    f.atendimentos.update(at,{revision:f.at.revision,name:'Cliente Sintético',vehicle:'',plate:'SYN-1A01'})
    const partial=await emit(budgets,at,f.scenario.id)
    f.atendimentos.update(at,{revision:f.atendimentos.get(at).revision,name:'',vehicle:'Modelo Sintético',plate:''})
    const missingPlate=await emit(budgets,at,f.scenario.id)
    const pdfs=[partial,missingPlate].map(version=>budgets.pdf(at,version.id))
    const record=f.atendimentos.get(at,true)
    f.atendimentos.update(at,{revision:record.revision,references:{
      ...record.references!,person:[{id:null,text:'cliente  sintético'}],
      vehicle:[{id:null,text:'Modelo Sintético',plate:'SYN1A01',modelYear:'2023'},
        {id:null,text:'Outro modelo sintético',plate:'SYN1A01',modelYear:'2023'}],
      payer:[{id:null,text:'Pagador sintético'}],
    }})
    const production=new ProductionRepository(db)
    const incompatible=scheduleInput(db,at,[missingPlate.id])
    incompatible.parties.vehicle=production.get(at).references.vehicle[1]!
    assert.throws(()=>production.schedule(at,incompatible),code('BUDGET_IDENTITY_CONFLICT'))
    const scheduled=production.schedule(at,scheduleInput(db,at,[partial.id,missingPlate.id]))
    assert.equal(scheduled.experience?.vehicle.modelYear,'2023')
    const order=production.authorize(at,partial.id,{confirmed:true})
    assert.deepEqual(order.scope.customer,{name:'Cliente Sintético'})
    assert.deepEqual(order.scope.vehicle,{description:'Modelo Sintético',plate:'SYN-1A01'})
    const complete=production.authorize(at,missingPlate.id,{confirmed:true})
    assert.deepEqual(complete.scope.customer,{name:'cliente  sintético'})
    assert.deepEqual(complete.scope.vehicle,{description:'Modelo Sintético',plate:'SYN1A01'})
    for(const [index,version] of [partial,missingPlate].entries()){
      assert.deepEqual(budgets.get(at,version.id),version)
      assert.deepEqual(budgets.pdf(at,version.id),pdfs[index])
    }
  }finally{db.close()}
})

test('V23 → V24 preserva OS e cancelamento histórico no banco reaberto sem atribuir consentimento ou Experiência',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'funix-production-upgrade-')), file=join(folder,'synthetic.sqlite')
  let db=openDatabase(file)
  try{
    const {at,budgets,versions}=await issued(db,2)
    const [existing,cancelled]=versions
    const originalPdf=budgets.pdf(at,existing!.id)
    removeV24FixtureSchema(db)
    const order=legacyOrder(db,existing!)
    const originalScope=db.prepare('SELECT scope_json FROM work_orders WHERE id=?').get(order.id)
    new BudgetCancellationRepository(db).cancel(at,cancelled!.id,{reason:'Cancelamento histórico sintético'})
    migrate(db)
    db.close();db=openDatabase(file)
    const production=new ProductionRepository(db)
    assert.equal(production.get(at).experience,null)
    assert.deepEqual(production.get(at).budgets.map(b=>[b.state,b.legacyOrder,b.history]),[['cancelled',false,[]],[null,true,[]]])
    assert.deepEqual(new WorkOrderRepository(db).get(at,existing!.id),order)
    assert.deepEqual(db.prepare('SELECT scope_json FROM work_orders WHERE id=?').get(order.id),originalScope)
    assert.deepEqual(new BudgetRepository(db).pdf(at,existing!.id),originalPdf)
    assert.throws(()=>production.authorize(at,existing!.id,{confirmed:true}),code('BUDGET_CONSENT_REQUIRED'))
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  }finally{db.close();rmSync(folder,{recursive:true,force:true})}
})

type RacePayload={action:'schedule'|'authorize'|'reject'; input:unknown; version?:string}
type RaceResult={ok:boolean;value?:{id?:string;experience?:{id:string}};code?:string}

async function simultaneous(file:string, at:string, tasks:RacePayload[]) {
  const barrier=new SharedArrayBuffer(4)
  return Promise.all(tasks.map(task=>new Promise<RaceResult>((resolve,reject)=>{
    const worker=new Worker(`
      const {parentPort,workerData}=require('node:worker_threads')
      ;(async()=>{
        const {openDatabase}=await import(workerData.database)
        const {ProductionRepository}=await import(workerData.production)
        const db=openDatabase(workerData.file)
        const repo=new ProductionRepository(db)
        const count=new Int32Array(workerData.barrier)
        Atomics.add(count,0,1);Atomics.notify(count,0)
        while(Atomics.load(count,0)<workerData.size){
          if(Atomics.wait(count,0,1,4000)==='timed-out')throw Error('Concurrency barrier timeout')
        }
        const {at,task}=workerData
        try{
          const value=task.action==='schedule'?repo.schedule(at,task.input):
            task.action==='authorize'?repo.authorize(at,task.version,task.input):repo.reject(at,task.version,'technical',task.input)
          parentPort.postMessage({ok:true,value})
        }catch(error){parentPort.postMessage({ok:false,code:error.code})}
        finally{db.close()}
      })().catch(error=>{throw error})
    `,{eval:true,workerData:{database:new URL('../database.ts',import.meta.url).href,
      production:new URL('../production.ts',import.meta.url).href,file,at,task,barrier,size:tasks.length}})
    worker.once('error',reject)
    worker.once('message',resolve)
    worker.once('exit',code=>{if(code!==0)reject(new Error('SQLite worker exited with '+code))})
  })))
}

test('Escritores SQLite paralelos convergem em uma Experiência e uma OS, com exclusão entre rejeição e autorização',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'funix-production-concurrency-')), file=join(folder,'synthetic.sqlite')
  const db=openDatabase(file)
  try{
    const {at,versions}=await issued(db,2)
    const [first,second]=versions.map(version=>version.id) as [string,string]
    identifyForProduction(db,at)
    const input=scheduleInput(db,at,[first,second])
    const scheduling=await simultaneous(file,at,[{action:'schedule',input},{action:'schedule',input}])
    assert(scheduling.every(result=>result.ok))
    assert.equal(scheduling[0]?.value?.experience?.id,scheduling[1]?.value?.experience?.id)
    const authorization={action:'authorize',version:first,input:{confirmed:true}} as const
    const orders=await simultaneous(file,at,[authorization,authorization])
    assert(orders.every(result=>result.ok))
    assert.equal(orders[0]?.value?.id,orders[1]?.value?.id)
    const competing=await simultaneous(file,at,[{...authorization,version:second},
      {action:'reject',version:second,input:{reason:'Rejeição técnica sintética'}}])
    assert.equal(competing.filter(result=>result.ok).length,1)
    assert(competing.some(result=>['BUDGET_REJECTION_CONFLICT','BUDGET_CONSENT_REQUIRED'].includes(result.code??'')))
    const overview=new ProductionRepository(db).get(at)
    assert.deepEqual(overview.budgets.find(b=>b.id===first)?.history.map(e=>e.to),['consented','authorized'])
    assert.equal(overview.budgets.find(b=>b.id===second)?.history.length,2)
    assert.equal(db.prepare('SELECT count(*) n FROM production_experiences').get()!.n,1)
    assert.equal(db.prepare('SELECT count(*) n FROM work_orders').get()!.n,competing[0]?.ok?2:1)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  }finally{db.close();rmSync(folder,{recursive:true,force:true})}
})
