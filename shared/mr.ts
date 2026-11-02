import type{PricingConfig,PricingSettings}from'./pricing.ts'
const unsigned=/^\d{1,12}(?:\.\d{1,6})?$/
function decimal(n:bigint,places:number){const sign=n<0n?'-':'',digits=(n<0n?-n:n).toString().padStart(places+1,'0');return sign+(places?(digits.slice(0,-places)+'.'+digits.slice(-places)).replace(/\.?0+$/,''):digits)}
export function canonicalPercent(value:unknown):string|null{
 if(typeof value!=='string'||!unsigned.test(value))return null
 const[w,f='']=value.split('.');return BigInt(w!).toString()+(f.replace(/0+$/,'')?'.'+f.replace(/0+$/,''):'')
}
export function percentInput(value:string){return canonicalPercent(value.trim().replace(/%$/,'').trim().replace(',','.'))}
export function percentToFactor(value:string):string|null{
 const p=canonicalPercent(value);if(p===null)return null
 const[w,f='']=p.split('.'),scale=10n**BigInt(f.length+2)
 return decimal(scale+BigInt(w!+f),f.length+2)
}
export function factorPercent(value:unknown):string|null{
 if(typeof value!=='string'||!/^\d{1,12}(?:\.\d{1,8})?$/.test(value))return null
 const[w,f='']=value.split('.'),scale=10n**BigInt(f.length)
 return decimal((BigInt(w!+f)-scale)*100n,f.length)
}
export function legacyPercent(value:unknown){const p=factorPercent(value);return p===null||p.startsWith('-')?null:canonicalPercent(p)}
export function resolveMR(settings:PricingSettings,config:Pick<PricingConfig,'resaleMultipliers'>){
 if(Object.hasOwn(settings,'mrPercent')){
  const percent=canonicalPercent(settings.mrPercent),factor=percent===null?null:percentToFactor(percent)
  return{percent,factor,source:'percent' as const}
 }
 const factor=config.resaleMultipliers?.find(m=>m.id===settings.mrId)?.factor??null
 return{percent:factorPercent(factor),factor:factorPercent(factor)===null?null:factor,source:'legacy' as const}
}
