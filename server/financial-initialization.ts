import type{DatabaseSync}from'node:sqlite'
import type{PricingConfig,PricingSettings}from'../shared/pricing.ts'
import{financialDefaults}from'../shared/financial-defaults.ts'
import{legacyPercent}from'../shared/mr.ts'
// Called inside the caller's write transaction, never from a read endpoint.
export function initializeFinancialSettings(db:DatabaseSync,at:string,newRecord=false){
 const state=db.prepare('SELECT settings_json FROM commercial_state WHERE atendimento_id=?').get(at)
 if(!state)throw Error('Estado comercial ausente.')
 const settings=JSON.parse(String(state.settings_json))as PricingSettings
 if(settings.defaultsInitialized)return false
 const c=db.prepare('SELECT data FROM pricing_configuration WHERE id=1').get()
 if(!c)throw Error('Configuração comercial ausente.')
 const config=JSON.parse(String(c.data))as PricingConfig,defaults=financialDefaults(config)
 for(const key of ['tableId','colorId','riskId']as const)if(!Object.hasOwn(settings,key))settings[key]=defaults[key]
 if(!Object.hasOwn(settings,'mrPercent')){
  if(!Object.hasOwn(settings,'mrId'))settings.mrPercent=defaults.mrPercent
  else if(settings.mrId){const p=legacyPercent(config.resaleMultipliers?.find(m=>m.id===settings.mrId)?.factor);if(p!==null){settings.mrPercent=p;settings.mrId=null}}
 }
 settings.defaultsInitialized=true
 db.prepare('UPDATE commercial_state SET settings_json=?,revision=revision+? WHERE atendimento_id=?').run(JSON.stringify(settings),newRecord?0:1,at)
 if(!newRecord)db.prepare('UPDATE scenarios SET revision=revision+1 WHERE atendimento_id=?').run(at)
 return true
}
