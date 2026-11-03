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
