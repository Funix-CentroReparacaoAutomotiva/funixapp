import {randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import type {BudgetVersion} from '../../../shared/pricing.ts'
import {AtendimentoRepository} from '../../atendimentos.ts'
import {ProductionRepository} from '../../production.ts'
import {operationalScope, WorkOrderRepository} from '../../work-orders.ts'

export function removeV25FixtureSchema(db: DatabaseSync) {
  db.exec('DROP TRIGGER IF EXISTS customer_active_channel_update; DROP TRIGGER IF EXISTS customer_active_channel_delete; DROP TRIGGER IF EXISTS customer_channel_owner_kind; DROP TRIGGER IF EXISTS customer_archived_contact_update; DROP TRIGGER IF EXISTS customer_association_contact_insert; DROP TRIGGER IF EXISTS customer_association_contact_update; DROP VIEW IF EXISTS customer_channel_contacts; DROP TRIGGER IF EXISTS customer_phone_key_insert; DROP TRIGGER IF EXISTS customer_phone_key_update; DROP INDEX IF EXISTS customer_contact_phone_unique; DELETE FROM schema_migrations WHERE version=25;')
}

/** Synthetic downgrade for migration fixtures. */
export function removeV24FixtureSchema(db: DatabaseSync) {
  removeV25FixtureSchema(db)
  db.exec(`
    DROP TRIGGER production_budget_cancellation;
    DROP TRIGGER production_transition_guard;
    DROP TRIGGER production_work_order_guard;
    DROP INDEX production_work_orders_experience;
    ALTER TABLE work_orders DROP COLUMN experience_id;
    DROP TABLE production_budget_transitions;
    DROP INDEX production_budget_owner;
    DROP TABLE production_experiences;
    DELETE FROM schema_migrations WHERE version=24;
  `)
}

/** Reproduce a pre-V24 OS in the historical schema, without any synthetic consent. */
export function legacyOrder(db: DatabaseSync, version: BudgetVersion, scope=operationalScope(version)) {
  const id=randomUUID(), now='2026-11-17T12:00:00.000Z'
  db.prepare(`INSERT INTO work_orders(id,atendimento_id,budget_version_id,created_at,authorized_at,authorization_source,
    authorized_by,budget_number,budget_label,scope_json) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id,version.atendimentoId,version.id,now,now,'authenticated-session-confirmation',null,
      version.documentNumber??'',version.label,JSON.stringify(scope))
  return new WorkOrderRepository(db).get(version.atendimentoId,version.id)
}

export function identifyForProduction(db: DatabaseSync, at: string) {
  const atendimentos=new AtendimentoRepository(db)
  const current=atendimentos.get(at,true), references=current.references!
  if(references.payer[0]?.text && references.vehicle[0]?.text)return current
  return atendimentos.update(at,{revision:current.revision,references:{
    ...references,
    vehicle:[{...references.vehicle[0]!,text:references.vehicle[0]?.text||'Veículo sintético'}],
    payer:[{id:null,text:'Pagador sintético'}],
  }})
}

export function scheduleInput(db: DatabaseSync, at: string, budgetIds: string[]) {
  const state=new ProductionRepository(db).get(at), {experience,references}=state
  return {
    budgetIds,
    parties: experience?{customer:experience.customer,vehicle:experience.vehicle,payer:experience.payer}:
      {customer:references.person[0]!,vehicle:references.vehicle[0]!,payer:references.payer[0]!},
    scheduledEntry:experience?.scheduledEntry??'2026-11-20T10:30',
    deliveryDate:state.deliveryDate,
    expectedAtendimentoRevision:state.atendimentoRevision, expectedExperienceRevision:experience?.revision??null,
  }
}

export function issueProductionOrder(db: DatabaseSync, at: string, version: string) {
  const production=new ProductionRepository(db)
  const budget=production.get(at).budgets.find(item=>item.id===version)
  if(budget?.state==='negotiating'){
    identifyForProduction(db,at)
    production.schedule(at,scheduleInput(db,at,[version]))
  }
  return production.authorize(at,version,{confirmed:true})
}
