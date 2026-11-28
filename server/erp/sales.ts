import type { DatabaseSync } from 'node:sqlite'
import { ATENDIMENTO_STAGES } from '../../shared/contracts.ts'
import type { Atendimento } from '../../shared/contracts.ts'
import { money as asMoney } from '../../shared/format.ts'
import { salesChannels } from '../../shared/sales.ts'
import type { SalesActivity, SalesContext, SalesMetric, SalesStage, TrackingCard } from '../../shared/sales.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { CustomerRepository } from '../customers.ts'
import { ServiceError } from '../errors.ts'
import { Q, ZERO, sum } from '../exact.ts'
import { funnelProjection } from '../funnel.ts'
import { ProductionRepository } from '../production.ts'
import type { ErpRequest } from './contracts.ts'
import { listWorkshopPhases, listWorkshopVehicles } from './workshop.ts'
import { experienceReceivables } from './finance.ts'
import { appendExperienceDiary, recordOrigin } from './experiences.ts'

const defaultStages: SalesStage[] = [
  {id:'novo-lead', label:'Novo contato', minutes:30},
  {id:'aguardando-dados', label:'Aguardando dados', minutes:24*60},
  {id:'em-negociacao', label:'Em negociação', minutes:48*60},
  {id:'morno', label:'Morno', minutes:3*24*60},
  {id:'frio', label:'Frio', minutes:5*24*60},
  {id:'rejeitados', label:'Orçamento rejeitado', minutes:null},
]
const blankContext: SalesContext = {owner:'', channel:'', origin:'', nextContactAt:null, nextAction:'', additionalService:'', revision:0}
const approvedStates = new Set(['consented','authorized','executed'])
const localDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'})
const fold=(text:string)=>text.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR')

export function migrateSales(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE erp_sales_stages (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      minutes INTEGER CHECK(minutes>0)
    );
    CREATE TABLE erp_sales_context (
      atendimento_id TEXT PRIMARY KEY REFERENCES atendimentos(id) ON DELETE RESTRICT,
      owner TEXT NOT NULL,
      next_contact_at TEXT,
      next_action TEXT NOT NULL,
      additional_service TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>0)
    );
    CREATE TABLE erp_sales_stage_events (
      id INTEGER PRIMARY KEY,
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,
      previous_stage TEXT NOT NULL,
      stage TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX erp_sales_stage_clock ON erp_sales_stage_events(atendimento_id,occurred_at);
    CREATE TRIGGER erp_sales_stage_activity AFTER UPDATE OF stage ON atendimentos
      WHEN OLD.stage IS NOT NEW.stage
      BEGIN
        INSERT INTO erp_sales_stage_events(atendimento_id,previous_stage,stage,occurred_at)
        VALUES(NEW.id,OLD.stage,NEW.stage,NEW.updated_at);
      END;
    CREATE TABLE erp_sales_contacts (
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE RESTRICT,
      message_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      PRIMARY KEY(atendimento_id,message_id)
    );
    CREATE INDEX erp_sales_contact_clock ON erp_sales_contacts(atendimento_id,occurred_at);
    CREATE TABLE erp_sales_goals (
      owner TEXT NOT NULL,
      start_day TEXT NOT NULL,
      end_day TEXT NOT NULL,
      amount TEXT NOT NULL,
      PRIMARY KEY(owner,start_day,end_day)
    );
  `)
  const insert = db.prepare('INSERT INTO erp_sales_stages VALUES(?,?,?)')
  for (const stage of defaultStages) insert.run(stage.id,stage.label,stage.minutes)
}

const invalid=(message:string):never=>{throw new ServiceError(422,'INVALID_SALES_INPUT',message)}
function bodyFields(body:unknown) {
  if(!body || typeof body!=='object' || Array.isArray(body))return invalid('Informe os dados da ação.')
  return body as Record<string,unknown>
}
function text(value:unknown,limit:number,required=false):string {
  if(typeof value!=='string' || value.trim().length>limit || (required&&!value.trim()))return invalid('Confira os campos obrigatórios e o tamanho dos textos.')
  return value.trim()
}
function dateTime(value:unknown) {
  if(value===null)return null
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))return invalid('Informe uma data e hora de retorno válida.')
  const iso=new Date(value).toISOString()
  if(iso.slice(0,19)!==value.slice(0,19))return invalid('Informe uma data e hora de retorno válida.')
  return iso
}
function day(value:unknown, fallback:string) {
  if(value===null||value===undefined||value==='')return fallback
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value))return invalid('Informe um período válido.')
  const time=Date.parse(value)
  if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)return invalid('Informe um período válido.')
  return value
}
function config(db:DatabaseSync):SalesStage[] {
  const rows=db.prepare('SELECT * FROM erp_sales_stages').all()
  return defaultStages.map(stage=>{
    const saved=rows.find(row=>row.id===stage.id)
    return saved?{id:stage.id,label:String(saved.label),minutes:saved.minutes===null?null:Number(saved.minutes)}:stage
  })
}
const origins = {initial:'Atendimento inicial', recurrence:'Recorrência', rework:'Retrabalho'} as const
function getContexts(db:DatabaseSync) {
  return new Map(db.prepare(`
    WITH ids AS (
      SELECT atendimento_id FROM erp_sales_context
      UNION SELECT atendimento_id FROM erp_experience_origin
    )
    SELECT ids.atendimento_id,s.owner,o.channel,o.origin,s.next_contact_at,s.next_action,s.additional_service,s.revision
    FROM ids LEFT JOIN erp_sales_context s USING(atendimento_id)
      LEFT JOIN erp_experience_origin o USING(atendimento_id)
  `).all().map(row=>[String(row.atendimento_id),{
    owner:String(row.owner??''),channel:String(row.channel??''),origin:origins[row.origin as keyof typeof origins]??'',
    nextContactAt:row.next_contact_at===null?null:String(row.next_contact_at),
    nextAction:String(row.next_action??''),additionalService:String(row.additional_service??''),revision:Number(row.revision??0)
  } satisfies SalesContext]))
}
function listRecords(db:DatabaseSync,q:string) {
  const repo=new AtendimentoRepository(db),customers=new CustomerRepository(db),records:Atendimento[]=[]
  let offset:number|null=0
  while(offset!==null) {
    const batch=repo.list({q,offset,limit:100})
    records.push(...customers.present(batch.items))
    offset=batch.nextOffset
  }
  return records
}
function criteria(context:SalesContext,query:URLSearchParams) {
  return ['owner','channel','origin'].every(key=>!query.get(key)||context[key as 'owner'|'channel'|'origin']===query.get(key))
}
function activityClock(db:DatabaseSync) {
  return new Map(db.prepare(`
    SELECT atendimento_id, MAX(occurred_at) AS most_recent FROM (
      SELECT atendimento_id,occurred_at FROM erp_sales_stage_events
      UNION ALL SELECT atendimento_id,occurred_at FROM erp_sales_contacts
      UNION ALL SELECT atendimento_id,occurred_at FROM erp_experience_diary WHERE source='commercial' AND kind='comment'
    ) GROUP BY atendimento_id`).all().map(row=>[String(row.atendimento_id),String(row.most_recent)]))
}
export function deadline(base:string,minutes:number|null,scheduled:string|null,now:number) {
  const at=scheduled??(minutes===null?null:new Date(Date.parse(base)+minutes*60_000).toISOString())
  return {nextContactAt:at,overdue:at!==null&&Date.parse(at)<=now}
}
function datesInOrder(a:string|null,b:string|null) {
  return (a??'9999').localeCompare(b??'9999')
}
function funnel(db:DatabaseSync,query:URLSearchParams,now:number) {
  const stages=config(db), contexts=getContexts(db), clocks=activityClock(db)
  const scheduled=new Set(db.prepare('SELECT atendimento_id FROM production_experiences').all().map(row=>String(row.atendimento_id)))
  const source=listRecords(db,query.get('q')??'')
  const lane=(record:Atendimento)=>record.purpose==='unclassified'?'triage':record.purpose==='non_commercial'?'non-commercial':record.stage
  const available=source.filter(r=>(!r.closedAt||r.stage==='rejeitados')&&(!scheduled.has(r.id)||r.stage==='rejeitados'))
  const availableContexts=available.map(r=>contexts.get(r.id)??blankContext)
  const selected=available.filter((r,index)=>criteria(availableContexts[index]!,query)&&(!query.get('stage')||query.get('stage')===lane(r)))
  const records=funnelProjection(db,selected)
  const cards=records.map(record=>{
    const context=contexts.get(record.id)??blankContext, lastActivityAt=clocks.get(record.id)??record.createdAt
    const stage=stages.find(candidate=>candidate.id===record.stage)!
    const currentLane=lane(record)
    const active=stage.minutes!==null&&currentLane!=='triage'&&currentLane!=='non-commercial'
    return {record,context,lane:currentLane,lastActivityAt,...deadline(lastActivityAt,active?stage.minutes:null,active?context.nextContactAt:null,now)}
  }).sort((a,b)=>datesInOrder(a.nextContactAt,b.nextContactAt)||a.record.createdAt.localeCompare(b.record.createdAt)||a.record.id.localeCompare(b.record.id))
  return {stages,cards,owners:[...new Set(availableContexts.map(c=>c.owner).filter(Boolean))].sort(),channels:[...new Set(availableContexts.map(c=>c.channel).filter(Boolean))].sort(),origins:[...new Set(availableContexts.map(c=>c.origin).filter(Boolean))].sort()}
}
function tracking(db:DatabaseSync,query:URLSearchParams,now:number):TrackingCard[] {
  const contexts=getContexts(db)
  const contacts=new Map(db.prepare('SELECT atendimento_id,MAX(occurred_at) AS last FROM erp_sales_contacts GROUP BY atendimento_id')
    .all().map(row=>[String(row.atendimento_id),String(row.last)]))
  const production=new ProductionRepository(db,()=>now)
  const search=fold(query.get('q')??'')
  const workshopPhases = new Map(listWorkshopPhases(db).map(phase => [phase.id,phase]))
  return listWorkshopVehicles(db)
    .filter(v=>!v.commercialClosedAt&&fold([v.model,v.plate,v.customer,v.payer].join(' ')).includes(search))
    .flatMap(vehicle=>{
      const context=contexts.get(vehicle.atendimentoId)??blankContext
      if(!criteria(context,query))return []
      const phase=workshopPhases.get(vehicle.phase)!
      const overview=production.get(vehicle.atendimentoId)
      const accepted=overview.budgets.filter(b=>approvedStates.has(b.state??''))
      return [{
        vehicle,commercialPhase:phase.commercial,tone:phase.tone,context,budgets:overview.budgets,
        approvedValue:accepted.length?accepted.reduce((total,b)=>total.add(Q.from(b.total)),ZERO).toString():null,
        lastContactAt:contacts.get(vehicle.atendimentoId)??null,
        receivables:experienceReceivables(db,vehicle.experienceId,localDay.format(now)),
      }]
    })
}
function trackingSummary(cards:TrackingCard[],now:number) {
  const values=cards.flatMap(card=>card.approvedValue===null?[]:[Q.from(card.approvedValue)])
  const balances=cards.flatMap(card=>card.receivables===null?[]:[BigInt(card.receivables.outstandingCents)])
  return {
    approvedValue:values.length?sum(values).toString():null,
    outstanding:balances.length?new Q(balances.reduce((total,value)=>total+value,0n),100n).toString():null,
    overdue:cards.filter(card=>card.context.nextContactAt&&Date.parse(card.context.nextContactAt)<=now).length,
  }
}
function dashboard(db:DatabaseSync,query:URLSearchParams,now:number) {
  const today=localDay.format(now)
  const firstOfMonth=today.slice(0,7)+'-01'
  const lastOfMonth=new Date(firstOfMonth)
  lastOfMonth.setUTCMonth(lastOfMonth.getUTCMonth()+1,0)
  const from=day(query.get('from'),firstOfMonth),to=day(query.get('to'),lastOfMonth.toISOString().slice(0,10))
  if(from>to)return invalid('A data inicial deve ser anterior à final.')
  const owner=query.get('owner')??''
  const contexts=getContexts(db)
  const owners=[...new Set([...contexts.values()].map(c=>c.owner).filter(Boolean))].sort()
  const owned=(id:string)=>!owner||contexts.get(id)?.owner===owner
  const within=(iso:string)=>{
    const date=localDay.format(new Date(iso))
    return date>=from&&date<=to
  }
  const allApproved=db.prepare(`SELECT t.id AS transition_id,t.atendimento_id,t.occurred_at,json_extract(b.snapshot,'$.calculation.total') AS total
    FROM production_budget_transitions t JOIN budget_versions b ON b.id=t.budget_version_id
    WHERE t.state='consented' AND NOT EXISTS(SELECT 1 FROM budget_cancellations c WHERE c.budget_version_id=b.id)
    AND NOT EXISTS (SELECT 1 FROM production_budget_transitions r WHERE r.budget_version_id=b.id AND r.state='rejected')`).all()
    .filter(row=>row.total!==null&&owned(String(row.atendimento_id)))
    .sort((a,b)=>String(a.occurred_at).localeCompare(String(b.occurred_at))||Number(a.transition_id)-Number(b.transition_id))
  const approved=allApproved.filter(row=>within(String(row.occurred_at)))
  const firstPositive=new Map<string,{occurredAt:string;id:number}>()
  for(const row of allApproved)if(Q.from(String(row.total)).cmp(ZERO)>0&&!firstPositive.has(String(row.atendimento_id)))firstPositive.set(String(row.atendimento_id),{occurredAt:String(row.occurred_at),id:Number(row.transition_id)})
  const saleIds=[...firstPositive].filter(([,first])=>within(first.occurredAt)).map(([id])=>id)
  const approvalIds=[...new Set(approved.map(row=>String(row.atendimento_id)))]
  const dailyTotals=new Map<string,{amount:Q;vehicles:number}>()
  const bucket=(date:string)=>{let value=dailyTotals.get(date);if(!value){value={amount:ZERO,vehicles:0};dailyTotals.set(date,value)}return value}
  for(const row of approved){const value=bucket(localDay.format(new Date(String(row.occurred_at))));value.amount=value.amount.add(Q.from(String(row.total)))}
  for(const id of saleIds)bucket(localDay.format(new Date(firstPositive.get(id)!.occurredAt))).vehicles++
  const daily=[...dailyTotals].sort(([a],[b])=>a.localeCompare(b)).map(([day,value])=>({day,amount:value.amount.toString(),vehicles:value.vehicles}))
  const approvedTotal=approved.reduce((total,row)=>total.add(Q.from(String(row.total))),ZERO)
  const unique=(items:string[])=>[...new Set(items)]
  const cards=funnel(db,query,now).cards
  const negotiating=cards.filter(c=>c.lane==='em-negociacao'&&c.record.commercialValue)
  const range=negotiating.reduce((total,c)=>({
    min:total.min.add(Q.from(c.record.commercialValue!.min)),max:total.max.add(Q.from(c.record.commercialValue!.max)),
  }),{min:ZERO,max:ZERO})
  const closed=listWorkshopVehicles(db).filter(v=>owned(v.atendimentoId)&&v.commercialClosedAt&&within(v.commercialClosedAt))
  const rejected=listRecords(db,'').filter(r=>r.stage==='rejeitados'&&owned(r.id))
  const exits=db.prepare(`SELECT atendimento_id,MAX(occurred_at) AS occurred_at FROM erp_sales_stage_events
    WHERE stage='rejeitados' GROUP BY atendimento_id`).all()
  const rejectedInPeriod=new Set(exits.filter(row=>within(String(row.occurred_at))).map(row=>String(row.atendimento_id)))
  const resolvedIds=unique([...approvalIds,...rejected.filter(r=>rejectedInPeriod.has(r.id)).map(r=>r.id)])
  const others=[...new Set(approved.filter(row=>{const first=firstPositive.get(String(row.atendimento_id));return Q.from(String(row.total)).cmp(ZERO)>0&&first!==undefined&&Number(row.transition_id)!==first.id}).map(row=>String(row.atendimento_id)))]
  const mean=approved.length?new Q(approvedTotal.mul(new Q(100n)).div(new Q(BigInt(approved.length))).add(new Q(1n,2n)).floor(),100n).toString():null
  const goal=db.prepare('SELECT amount FROM erp_sales_goals WHERE owner=? AND start_day=? AND end_day=?').get(owner,from,to)?.amount
  const received=db.prepare(`
    SELECT e.atendimento_id, s.amount_cents, s.discount_cents, s.withheld_iss_cents
    FROM financial_settlements s JOIN financial_titles t ON t.id=s.title_id
    JOIN production_experiences e ON e.id=t.experience_id
    WHERE t.kind='receivable' AND s.reversed_at IS NULL AND s.date BETWEEN ? AND ?
  `).all(from,to).filter(row=>owned(String(row.atendimento_id)))
  const receivedCents=received.reduce((total,row)=>total+BigInt(Number(row.amount_cents)-Number(row.discount_cents)-Number(row.withheld_iss_cents)),0n)
  return {
    owners,from,to,goal:goal===undefined?null:String(goal), today,daily,approvedTotal:approvedTotal.toString(),
    metrics:[
      {label:'Valor aprovado',value:asMoney(approvedTotal.toString()),definition:'Soma dos orçamentos consentidos no período, sem cancelamentos ou rejeições técnicas.',records:approvalIds},
      {label:'Valor recebido',value:asMoney(new Q(receivedCents,100n).toString()),definition:'Entradas líquidas de clientes vinculadas a Experiências, pela data da liquidação. Exclui estornos, descontos e ISS retido.',records:unique(received.map(row=>String(row.atendimento_id)))},
      {label:'Valor faturado',value:'—',definition:'A nota vinculada à liquidação não fornece uma data de faturamento independente.',records:[]},
      {label:'Vendas aprovadas',value:String(saleIds.length),definition:'Primeira aprovação com valor positivo por Atendimento; orçamentos complementares não duplicam a venda.',records:saleIds},
      {label:'Conversão',value:resolvedIds.length?(approvalIds.length/resolvedIds.length).toLocaleString('pt-BR',{style:'percent',maximumFractionDigits:1}):'—',definition:'Atendimentos aprovados divididos pelos aprovados ou rejeitados com decisão registrada no período.',records:resolvedIds},
      {label:'Valor médio',value:mean===null?'—':asMoney(mean),definition:'Valor aprovado dividido pelo número de orçamentos consentidos no período.',records:approvalIds},
      {label:'Em negociação',value:negotiating.length?(range.min.cmp(range.max)===0?asMoney(range.min.toString()):asMoney(range.min.toString())+' a '+asMoney(range.max.toString())):'—',definition:'Faixa de valor dos atendimentos atualmente Em negociação. Cenários alternativos não são somados.',records:negotiating.map(c=>c.record.id),href:'/vendas/funil?stage=em-negociacao'},
      {label:'Serviços adicionais',value:String(others.length),definition:'Atendimentos com orçamento adicional de valor positivo aprovado após a primeira venda.',records:others},
      {label:'Experiências encerradas',value:String(closed.length),definition:'Fechamentos comerciais registrados após a saída física no período.',records:closed.map(v=>v.atendimentoId)},
    ] satisfies SalesMetric[],
    priorities:[
      {label:'Novos contatos',records:cards.filter(c=>c.lane==='novo-lead'||c.lane==='triage').map(c=>c.record.id)},
      {label:'Retornos vencidos',records:cards.filter(c=>c.overdue).map(c=>c.record.id)},
      {label:'Clientes a atualizar',records:tracking(db,query,now).filter(c=>c.context.nextContactAt&&Date.parse(c.context.nextContactAt)<=now).map(c=>c.vehicle.atendimentoId)},
      {label:'Entregas previstas hoje',records:listWorkshopVehicles(db).filter(v=>v.deliveryDate===today&&!v.departedAt&&owned(v.atendimentoId)).map(v=>v.atendimentoId)},
    ],
  }
}

function activity(db:DatabaseSync,id:string):SalesActivity[] {
  const stages=config(db)
  return db.prepare(`
    SELECT 'stage:'||id AS id,'stage' AS kind,occurred_at,NULL AS author,stage AS content
      FROM erp_sales_stage_events WHERE atendimento_id=?
    UNION ALL
    SELECT 'message:'||message_id,'message',occurred_at,NULL,'Mensagem de WhatsApp enviada'
      FROM erp_sales_contacts WHERE atendimento_id=?
    UNION ALL
    SELECT id,'comment',occurred_at,author,body FROM erp_experience_diary
      WHERE atendimento_id=? AND source='commercial' AND kind='comment'
    ORDER BY occurred_at DESC,id DESC LIMIT 30
  `).all(id,id,id).map(row=>({
    id:String(row.id),kind:row.kind as SalesActivity['kind'],occurredAt:String(row.occurred_at),
    author:row.author===null?null:String(row.author),
    content:row.kind==='stage'?('Etapa alterada para '+(stages.find(stage=>stage.id===row.content)?.label??row.content)):String(row.content),
  }))
}
export function handleSales({db,method,path,query,body,now}:ErpRequest):unknown {
  const clock=now()
  if(method==='GET' && path==='/funnel')return funnel(db,query,clock)
  if(method==='GET' && path==='/tracking') {
    const cards=tracking(db,query,clock)
    const owners=[...new Set([...getContexts(db).values()].map(context=>context.owner).filter(Boolean))].sort()
    return {cards,owners,summary:trackingSummary(cards,clock)}
  }
  if(method==='GET' && path==='/dashboard')return dashboard(db,query,clock)
  if(method==='GET' && path==='/stages')return {stages:config(db)}
  if(method==='GET' && path==='/records') {
    const ids=(query.get('ids')??'').split(',').slice(0,50).filter(Boolean)
    const repo=new AtendimentoRepository(db)
    return {records:ids.map(id=>repo.get(id,true))}
  }
  const recordRoute=/^\/records\/([a-f0-9-]+)\/(activity|context|stage|comment|summary|data)$/.exec(path)
  if(recordRoute) {
    const id=recordRoute[1]!, repo=new AtendimentoRepository(db), record=repo.get(id)
    const action=recordRoute[2]
    if(method==='GET' && action==='summary'){
      const context=getContexts(db).get(id)??blankContext
      const experience=db.prepare('SELECT id FROM production_experiences WHERE atendimento_id=?').get(id)
      const matching=experience?tracking(db,new URLSearchParams(),clock).find(card=>card.vehicle.atendimentoId===id):null
      const projected=funnelProjection(db,[repo.get(id,true)])[0]??repo.get(id,true)
      return {record:projected,context,stages:config(db),experienceId:experience?String(experience.id):null,tracking:matching??null}
    }
    if(method==='GET' && action==='activity')return {entries:activity(db,id)}
    if(method==='POST') {
      const fields=bodyFields(body)
      // One revision-controlled transaction for the inline identity and commercial
      // form. No owner/next-action edits are accepted here; preserve legacy data.
      if(action==='data') {
        const patch=bodyFields(fields.record)
        const allowed=new Set(['revision','references','phone','name','vehicle','brand','model','plate','fabricationYear','modelYear','notes','purpose','channel','stage','rejectionReason','explicitRefusal','closed'])
        if(Object.keys(patch).some(key=>!allowed.has(key)))return invalid('Campo fora dos dados do Atendimento.')
        const current=getContexts(db).get(id)??blankContext
        if(fields.contextRevision!==current.revision)throw new ServiceError(409,'VERSION_CONFLICT','Os dados comerciais mudaram. Reabra antes de salvar.')
        if(patch.revision!==record.revision)throw new ServiceError(409,'VERSION_CONFLICT','O Atendimento mudou. Reabra antes de salvar.')
        const nextContactAt=fields.nextContactAt===undefined?current.nextContactAt:dateTime(fields.nextContactAt)
        const scheduled=!!db.prepare('SELECT 1 FROM production_experiences WHERE atendimento_id=?').get(id)
        if(scheduled&&(patch.purpose==='non_commercial'||(patch.stage!==undefined&&patch.stage!==record.stage)||patch.closed!==undefined))
          return invalid('Altere a situação de uma Experiência agendada na operação.')
        db.exec('BEGIN IMMEDIATE')
        try {
          const updated=repo.update(id,patch,true,true,true)
          // saveChannel may increment the commercial revision; the upsert only
          // changes the next-contact value, leaving old ownership untouched.
          if(nextContactAt!==current.nextContactAt)db.prepare(`INSERT INTO erp_sales_context VALUES(?,?,?,?,?,1)
            ON CONFLICT(atendimento_id) DO UPDATE SET next_contact_at=excluded.next_contact_at,revision=erp_sales_context.revision+1`)
            .run(id,current.owner,nextContactAt,current.nextAction,current.additionalService)
          const context=getContexts(db).get(id)??blankContext
          db.exec('COMMIT')
          return {record:updated,context}
        } catch(error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
      if(action==='context') {
        const current=getContexts(db).get(id)??blankContext
        if(fields.revision!==current.revision)throw new ServiceError(409,'SALES_CONTEXT_CONFLICT','O registro comercial mudou. Reabra os detalhes antes de salvar.')
        const owner=text(fields.owner,100), channel=text(fields.channel,100)
        if(channel&&channel!==current.channel&&!salesChannels.some(candidate=>candidate===channel))return invalid('Selecione um canal cadastrado.')
        const nextContactAt=dateTime(fields.nextContactAt),nextAction=text(fields.nextAction,500),additionalService=fields.additionalService===undefined?current.additionalService:text(fields.additionalService,1000)
        const purpose=fields.purpose
        if(purpose!==undefined&&purpose!=='commercial'&&purpose!=='non_commercial'&&purpose!=='unclassified')return invalid('Confira a classificação.')
        if(purpose!==undefined&&purpose!==record.purpose&&fields.recordRevision!==record.revision)throw new ServiceError(409,'VERSION_CONFLICT','O Atendimento mudou. Reabra antes de classificar.')
        if(purpose==='non_commercial'&&db.prepare('SELECT id FROM production_experiences WHERE atendimento_id=?').get(id))return invalid('Uma Experiência agendada não pode ser marcada como não comercial.')
        db.exec('BEGIN IMMEDIATE')
        try {
          db.prepare(`INSERT INTO erp_sales_context VALUES(?,?,?,?,?,1)
            ON CONFLICT(atendimento_id) DO UPDATE SET owner=excluded.owner,next_contact_at=excluded.next_contact_at,
            next_action=excluded.next_action,additional_service=excluded.additional_service,revision=erp_sales_context.revision+1`)
            .run(id,owner,nextContactAt,nextAction,additionalService)
          if(channel!==current.channel)recordOrigin(db,{atendimentoId:id,channel})
          if(purpose!==undefined&&purpose!==record.purpose)repo.update(id,{revision:record.revision,purpose},false,false,true)
          db.exec('COMMIT')
        } catch(error) {
          db.exec('ROLLBACK')
          throw error
        }
        return {context:getContexts(db).get(id),record:repo.get(id,true)}
      }
      if(action==='stage') {
        const stage=ATENDIMENTO_STAGES.find(stage=>stage.id===fields.stage)?.id
        if(!stage||record.closedAt||db.prepare('SELECT 1 FROM production_experiences WHERE atendimento_id=?').get(id))return invalid('A etapa só pode ser alterada no Funil aberto.')
        if(fields.revision!==record.revision)throw new ServiceError(409,'VERSION_CONFLICT','A etapa mudou. Reabra o registro antes de salvar.')
        if(stage===record.stage)return {record}
        const rejectionReason=stage==='rejeitados'?text(fields.reason,2000,true):''
        return {record:repo.update(id,{stage,revision:record.revision,rejectionReason,explicitRefusal:stage==='rejeitados'})}
      }
      if(action==='comment') {
        const comment=text(fields.comment,8000,true),author=fields.author===undefined?'funix_operator':text(fields.author,120,true)
        const requestId=text(fields.requestId,120,true)
        return {entry:appendExperienceDiary(db,{atendimentoId:id,source:'commercial',sourceId:requestId,kind:'comment',body:comment,author,occurredAt:new Date(clock).toISOString()})}
      }
    }
  }
  if(method==='POST' && path==='/stages') {
    const fields=bodyFields(body)
    const stage=defaultStages.find(stage=>stage.id===fields.id)
    if(!stage)return invalid('Selecione uma etapa comercial.')
    const label=text(fields.label,80,true)
    const minutes=stage.minutes===null?null:fields.minutes
    if(minutes!==null&&(typeof minutes!=='number'||!Number.isSafeInteger(minutes)||minutes<1||minutes>60*24*366))return invalid('Informe a cadência de 1 minuto a 366 dias.')
    db.prepare('UPDATE erp_sales_stages SET label=?,minutes=? WHERE id=?').run(label,minutes,stage.id)
    return {stages:config(db)}
  }
  if(method==='POST' && path==='/goals') {
    const fields=bodyFields(body)
    const owner=text(fields.owner,100), from=day(fields.from,''), to=day(fields.to,'')
    const amount=text(fields.amount,16,true).replace(',','.')
    if(!from||!to||from>to||!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount))return invalid('Informe o período e uma meta monetária válida.')
    db.prepare(`INSERT INTO erp_sales_goals VALUES(?,?,?,?) ON CONFLICT(owner,start_day,end_day) DO UPDATE SET amount=excluded.amount`)
      .run(owner,from,to,Q.from(amount).toString())
    return {amount}
  }
  throw new ServiceError(404,'SALES_ROUTE_NOT_FOUND','Visão comercial não encontrada.')
}
