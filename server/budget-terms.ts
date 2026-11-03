import type{DatabaseSync}from'node:sqlite'
import type{ExecutionDeadline,InstallmentConfiguration,InstallmentSnapshot,ScenarioDeadline}from'../shared/budget-terms.ts'
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
export function executionDeadline(setting:ScenarioDeadline|undefined,technicalDays:string|null):ExecutionDeadline{
 const configured=setting??{mode:'automatic',manualDays:null},suggestion=technicalDays&&/^\d+$/.test(technicalDays)&&Number.isSafeInteger(Number(technicalDays))&&Number(technicalDays)>0?Number(technicalDays):null
 const effectiveDays=configured.mode==='manual'?configured.manualDays:suggestion
 return{...configured,technicalDays,effectiveDays,warning:configured.mode==='manual'&&effectiveDays!==null?(suggestion===null?'Estimativa técnica de prazo indisponível; será utilizado o prazo manual informado.':effectiveDays<suggestion?'Prazo manual menor que a sugestão técnica atual.':null):null}
}

// A manually supplied commercial deadline replaces only the missing capacity-derived
// suggestion. Prices, energy and every other existing engine error remain blocking.
export function budgetBlockingErrors(snapshot:BudgetSnapshot):string[]{
 const d=snapshot.executionDeadline,manual=d?.mode==='manual'&&d.effectiveDays!==null&&snapshot.calculation.energy!==null
 return snapshot.calculation.errors.filter(error=>!(manual&&error==='Capacidade diária global positiva não configurada.'))
}
