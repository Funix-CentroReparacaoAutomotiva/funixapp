// Reproducible acceptance matrix. Actual source values stay in memory/private export.
// No app/production database is opened; monetary outputs are deliberately not printed.
import {readFileSync,writeFileSync} from 'node:fs'
import {openDatabase} from '../server/database.ts'
import {planImport,applyImport} from '../server/coda-import.ts'
import {parseCodaJson,sourceId,TABLES} from '../server/coda-import-source.ts'
import {AtendimentoRepository} from '../server/atendimentos.ts'
import {CommercialRepository} from '../server/commercial.ts'
import {ScenarioRepository} from '../server/scenarios.ts'
import {PricingConfigurationRepository} from '../server/pricing-config.ts'
import {BudgetRepository} from '../server/budgets.ts'

const [sourceFile,output]=process.argv.slice(2)
if(!sourceFile || !output || process.argv.length!==4)throw new Error('Uso: node scripts/check-coda-import-cases.ts EXPORT_PRIVADO.json MATRIZ_NOVA.json')
const source=parseCodaJson(readFileSync(sourceFile,'utf8')),db=openDatabase(':memory:')
try{
 const plan=planImport(db,source)
 if(plan.report.conflicts.length)throw new Error('Fonte possui conflitos.')
 applyImport(db,source,plan.planHash)
 const catalog=new CommercialRepository(db),pricing=new PricingConfigurationRepository(db),budgets=new BudgetRepository(db)
 const color=plan.config.colors[0],risk=plan.config.risks[0]
 if(!color || !risk)throw new Error('FC/FR reais não disponíveis para a matriz.')
 const matrix=[]
 // Source IDs, not names, identify the representative services originally inspected.
 for(const row of ['i-q8IL0mnuIJ','i-XDTMBmueos','i-vmJ3Org23i']){
  const serviceId=sourceId(TABLES.services,row),service=catalog.item(serviceId),dimensions=catalog.catalogs().items.filter(c=>c.kind==='dimensao' && c.serviceId===serviceId)
  if(!dimensions.length)throw new Error('Serviço representativo sem dimensões na fonte.')
  const at=new AtendimentoRepository(db).create({phone:'123',name:'QA MATRIZ SINTÉTICA — NÃO OPERACIONAL'})
  let item=catalog.add(at.id,{pieceCodes:['capo']})[0]!
  const scenario=new ScenarioRepository(db).list(at.id)[0]!
  for(const table of plan.config.tables){
   const cases=[]
   for(const dimension of dimensions){
    item=catalog.updateDiagnosis(at.id,item.id,{revision:item.revision,services:[{serviceId,dimensionId:dimension.id,quantity:'1'}]})
    pricing.saveSettings(at.id,{revision:pricing.settings(at.id).revision,tableId:table.id,colorId:color.id,riskId:risk.id})
    const preview=budgets.preview(at.id,{scenarioId:scenario.id,negotiation:{mode:'none'}})
    const reasons=preview.snapshot.calculation.errors.map(e=>e.includes('): ')?e.slice(e.indexOf('): ')+3):e)
    cases.push({dimensionId:dimension.id,dimension:dimension.name,canEmitServiceOnly:preview.canEmit,reasons:[...new Set(reasons)]})
   }
   matrix.push({serviceId,service:service.name,tableId:table.id,table:table.name,calculable:cases.filter(c=>c.canEmitServiceOnly).length,blocked:cases.filter(c=>!c.canEmitServiceOnly).length,cases})
  }
 }
 const report={sourceDigest:plan.sourceDigest,scope:'Serviços, quantidade 1, sem componentes/negociação. Não equivale a orçamento com revenda ou a homologação produtiva.',parameters:{colorId:color.id,color:color.name,riskId:risk.id,risk:risk.name},resaleMultipliersConfigured:plan.config.resaleMultipliers?.length??0,matrix}
 writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600})
 console.log(JSON.stringify({groups:matrix.length,cases:matrix.reduce((n,g)=>n+g.cases.length,0),calculable:matrix.reduce((n,g)=>n+g.calculable,0),blocked:matrix.reduce((n,g)=>n+g.blocked,0)}))
}finally{db.close()}
