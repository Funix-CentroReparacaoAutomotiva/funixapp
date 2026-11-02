// Direction Issue #31: 6559947927 / 6560532482. IDs only; no commercial prices.
export const CURATION_VERSION='funix-commercial-2026-11-01-v1'
const prefix='coda:2zsjI-nqWr:grid-lhdFxol6x-:'
export const codaServiceId=(row:string)=>prefix+row
export const TECHNICAL_ACTIVITY='technical-assessment'
const known=['i-GsuErCDZgL','i-5zkNjBv-Zg','i-q8IL0mnuIJ','i-SW0n7TLbtf','i-qCp1gLfJn4','i-6FW6UIOr8H','i-6v-u7Wk73b','i-kNfje5jSDQ','i-RoaRcVLUCo','i-JPNGbPVOdw','i-AlsNigbGqx','i-vmJ3Org23i','i-ZBJbRcSeSQ','i-XDTMBmueos','i-NG0WMuMSy1','i-MC_Z0KK6Hn','i-qErkcLJo2u','i-lMM5GA_1uz','i-CRzSKxZBUr','i-SZ64QNvn0M','i-MMsEFTPdow','i-6tWzUWof8c','i-dMshyG5NMo','i-NzZMurcx8O','i-odnULcJj8z','i-mdMBxgFQJC','i-VQqzDP1-v2','i-CGNms9jzj3']
const hidden=new Set(['i-qCp1gLfJn4','i-JPNGbPVOdw'])
const free=new Set(['i-GsuErCDZgL','i-dMshyG5NMo','i-lMM5GA_1uz','i-odnULcJj8z'])
const external=new Set(['i-6FW6UIOr8H','i-6v-u7Wk73b','i-kNfje5jSDQ','i-RoaRcVLUCo','i-qErkcLJo2u'])
const technical=new Set(['i-GsuErCDZgL','i-dMshyG5NMo'])
export interface ServicePolicy {visible:boolean;billing:'billable'|'not_billed';execution:'internal'|'external_confirmation';group?:string;canonicalBlocked?:boolean;displayName?:string;unit?:string}
export const SERVICE_POLICIES:Record<string,ServicePolicy>=Object.fromEntries(known.map(row=>[codaServiceId(row),{
 visible:!hidden.has(row),billing:free.has(row)?'not_billed':'billable',execution:external.has(row)?'external_confirmation':'internal',
 ...(technical.has(row)?{group:TECHNICAL_ACTIVITY,canonicalBlocked:true,displayName:'Diagnóstico / inspeção técnica'}:{}),
 ...(row==='i-6tWzUWof8c'?{displayName:'Alinhamento estrutural / da carroceria'}:{}),
 ...(row==='i-MMsEFTPdow'?{displayName:'Restauração de lentes de faróis e lanternas'}:{}),
 ...(row==='i-5zkNjBv-Zg'?{unit:'HH'}:{})
}]))
export const COMMERCIAL_CURATION={version:CURATION_VERSION,services:SERVICE_POLICIES}
export const servicePolicy=(id:string)=>SERVICE_POLICIES[id]
export const isCodaCommercialService=(id:string)=>id.startsWith(prefix)
export function newServiceSelectionIssue(id:string):string|null {
 const p=servicePolicy(id)
 if(!p)return isCodaCommercialService(id)?'Serviço de origem sem curadoria aprovada.':null
 if(!p.visible)return 'Serviço fora de novas seleções; referências existentes foram preservadas.'
 if(p.canonicalBlocked)return 'Atividade técnica única: identificação canônica bloqueada até auditoria histórica. Nenhuma origem foi escolhida.'
 return null
}
export function executionScope(line:{serviceId:string;dimensionId:string|null;quantity:string}){
 const quantity=line.quantity.includes('.')?line.quantity.replace(/0+$/,'').replace(/\.$/,''):line.quantity
 return JSON.stringify([CURATION_VERSION,servicePolicy(line.serviceId),line.serviceId,line.dimensionId,quantity])
}
