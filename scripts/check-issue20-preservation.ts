// Development QA only: refuses an existing destination. Never reads the app DB default/.env.
import assert from 'node:assert/strict'
import {existsSync,readFileSync} from 'node:fs'
import {openDatabase} from '../server/database.ts'
import {planImport,applyImport} from '../server/coda-import.ts'
import {parseCodaJson} from '../server/coda-import-source.ts'
import {commercialFixture} from '../server/tests/fixtures/commercial.ts'
import {BudgetRepository} from '../server/budgets.ts'

const [sourceFile,destination]=process.argv.slice(2)
if(!sourceFile || !destination || process.argv.length!==4 || existsSync(destination))throw new Error('Uso QA: node scripts/check-issue20-preservation.ts FONTE_PRIVADA.json BANCO_QA_NOVO.sqlite (destino deve ser novo).')
const source=parseCodaJson(readFileSync(sourceFile,'utf8'))
let db=openDatabase(destination)
try{
 const capacity=planImport(db,source).config.capacity
 assert(capacity)
 const f=commercialFixture(db),config={...f.pricing.get().config,capacity}
 f.pricing.save({revision:f.pricing.get().revision,config})
 const budgets=new BudgetRepository(db),request={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
 const preview=budgets.preview(f.at.id,request),version=budgets.emit(f.at.id,{...request,previewToken:preview.token,idempotencyKey:'issue20-qa-real-source'})
 const pdf=budgets.pdf(f.at.id,version.id),at=f.atendimentos.get(f.at.id),items=f.commercial.list(f.at.id),scenarios=f.scenarios.list(f.at.id),settings=f.pricing.settings(f.at.id)
 const plan=planImport(db,source)
 assert.deepEqual(plan.report.conflicts,[])
 applyImport(db,source,plan.planHash)
 const revision=f.pricing.get().revision,repeat=planImport(db,source)
 assert.equal(repeat.report.inserts,0);applyImport(db,source,repeat.planHash);assert.equal(f.pricing.get().revision,revision)
 assert.deepEqual(f.atendimentos.get(at.id),at);assert.deepEqual(f.commercial.list(at.id),items);assert.deepEqual(f.scenarios.list(at.id),scenarios);assert.deepEqual(f.pricing.settings(at.id),settings)
 assert.deepEqual(budgets.get(at.id,version.id),version);assert.deepEqual(budgets.pdf(at.id,version.id),pdf)
 db.close();db=openDatabase(destination)
 const reopened=new BudgetRepository(db)
 assert.deepEqual(reopened.get(at.id,version.id),version);assert.deepEqual(reopened.pdf(at.id,version.id),pdf)
 assert.equal(db.prepare("SELECT COUNT(*) n FROM catalog_items WHERE kind='peca'").get()!.n,163)
 assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v,7)
 assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 console.log(JSON.stringify({passed:true,preservedPieces:163,preservedAtendimento:true,preservedCompositionAndScenarios:true,preservedSettings:true,preservedSnapshotAndPdf:true,restart:true,idempotent:true,schema:7,foreignKeys:'ok',integrity:'ok'}))
}finally{db.close()}
