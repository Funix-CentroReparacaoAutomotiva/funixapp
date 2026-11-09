import type{DatabaseSync}from'node:sqlite'
import type{InstallmentConfiguration,InstallmentSnapshot}from'../shared/budget-terms.ts'
import{INSTALLMENT_PLANS}from'../shared/budget-terms.ts'
import{Q}from'./exact.ts'
import{conflict,inputObject,invalid,transaction}from'./scenarios.ts'
import{decimal}from'./pricing-config.ts'
import type{BudgetSnapshot}from'../shared/pricing.ts'

export class InstallmentRepository{
 readonly db:DatabaseSync
 constructor(db:DatabaseSync){this.db=db}
 get():InstallmentConfiguration{const r=this.db.prepare('SELECT * FROM installment_configuration WHERE id=1').get()!;return{revision:Number(r.revision),updatedAt:String(r.updated_at),rates:JSON.parse(String(r.rates))}}
 save(input:unknown):InstallmentConfiguration{
  const d=inputObject(input,['revision','rates']),rates=inputObject(d.rates,INSTALLMENT_PLANS.map(([key])=>key))
  const values=Object.fromEntries(INSTALLMENT_PLANS.map(([key])=>[key,decimal(rates[key])]))
  if(!Number.isSafeInteger(d.revision))invalid('Informe a revisão do parcelamento.')
  return transaction(this.db,()=>{if(this.get().revision!==d.revision)conflict();this.db.prepare('UPDATE installment_configuration SET rates=?,revision=revision+1,updated_at=? WHERE id=1').run(JSON.stringify(values),new Date().toISOString());return this.get()})
 }
}
export function exactAmount(value:string):Q{
 if(!/^(-?)\d{1,32}(?:\.\d{1,24})?$/.test(value))throw Error('Valor decimal interno inválido.')
 const negative=value.startsWith('-'),[whole,fraction='']=(negative?value.slice(1):value).split('.')
 return new Q(BigInt(whole+fraction)*(negative?-1n:1n),10n**BigInt(fraction.length))
}
export function centAmount(q:Q):string{
 const negative=q.n<0n,n=negative?-q.n:q.n,cents=(n*200n+q.d)/(q.d*2n)
 return(negative&&cents?'-':'')+(cents/100n)+'.'+String(cents%100n).padStart(2,'0')
}
export function installmentSnapshot(total:string,configuration:InstallmentConfiguration):InstallmentSnapshot{
 const plans={}as InstallmentSnapshot['plans'],viewTotal=exactAmount(total)
 for(const[key,count]of INSTALLMENT_PLANS){
  const exactTotal=viewTotal.mul(new Q(1n).add(Q.from(configuration.rates[key]).div(new Q(100n)))),exactUnit=exactTotal.div(new Q(BigInt(count)))
  const shownTotal=centAmount(exactTotal),unit=centAmount(exactUnit)
  plans[key]={count,percent:configuration.rates[key],total:shownTotal,unit,exactTotal:{n:String(exactTotal.n),d:String(exactTotal.d)},exactUnit:{n:String(exactUnit.n),d:String(exactUnit.d)},displayDifference:Q.from(unit).mul(new Q(BigInt(count))).sub(Q.from(shownTotal)).toString()}
 }
 return{revision:configuration.revision,rates:structuredClone(configuration.rates),rounding:'half-up-cent-independent',plans}
}
export {executionDeadline}from'../shared/budget-terms.ts'

// Missing technical-stage detail remains visible in the app, not in the PDF.
// Duplicate stages and actual pricing/scope errors are not made optional.
export function optionalTechnicalWarning(error:string):boolean{
 return error.endsWith(': Etapas técnicas de serviço/dimensão não configuradas.')
  ||error.endsWith(': Energia técnica não configurada; considerada zero para este serviço.')
  ||(error.startsWith('PDF: ')&&(
   error.endsWith(': origem serviço/dimensão ausente.')
   ||error.endsWith(': etapas técnicas não configuradas para a apresentação.')
   ||error.includes(': categoria ausente/não reconhecida na etapa ')
   ||(error.includes(': energia da etapa ')&&error.endsWith(' ausente.'))
   ||error.endsWith(': energia total das etapas igual a zero; não existe proporção financeira válida.')
  ))
}
// Manual deadline replaces only a missing technical suggestion, not invalid prices.
export function budgetBlockingErrors(snapshot:BudgetSnapshot):string[]{
 const d=snapshot.executionDeadline,manual=d?.mode==='manual'&&d.effectiveDays!==null&&snapshot.calculation.energy!==null
 return [...snapshot.calculation.errors.filter(error=>!optionalTechnicalWarning(error)&&!(manual&&error==='Capacidade diária global positiva não configurada.')),...(snapshot.pdfPresentation?.errors??[]).filter(error=>!optionalTechnicalWarning(error))]
}
