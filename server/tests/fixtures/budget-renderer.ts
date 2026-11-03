// Synthetic regression double only. Production never falls back to the legacy PDF renderer.
import type{DatabaseSync}from'node:sqlite'
import{BudgetRepository as RealBudgets}from'../../budgets.ts'
import{budgetPdf}from'../../pdf.ts'
import{renderJsreportPdf}from'../../jsreport-client.ts'
import{frozenTerms}from'../../jsreport-adapter.ts'
import type{BudgetVersion}from'../../../shared/pricing.ts'
export{versionLabel,commercialNumber,budgetFilename}from'../../budgets.ts'
export const syntheticRenderer=(version:BudgetVersion)=>renderJsreportPdf(version,frozenTerms(version.snapshot),{endpoint:'https://jsreport.test.invalid/api/report',username:'synthetic',password:'synthetic-only',template:'FUNIX - Orcamento'},async()=>new Response(new Uint8Array(budgetPdf(version)),{headers:{'Content-Type':'application/pdf'}}))
export class BudgetRepository extends RealBudgets{constructor(db:DatabaseSync){super(db,{render:syntheticRenderer})}}

// Explicit operator-like setup for legacy synthetic fixtures before NEW emissions.
export async function configureSyntheticStageCategories(db:DatabaseSync){
 const{PricingConfigurationRepository}=await import('../../pricing-config.ts'),repo=new PricingConfigurationRepository(db),current=repo.get()
 for(const service of current.config.services)for(const dimension of service.dimensions)for(const stage of dimension.stages)stage.presentation={stageId:null,stageDimensionId:null,clusterId:null,cluster:'Preparação técnica',order:null}
 repo.save({revision:current.revision,config:current.config})
}
