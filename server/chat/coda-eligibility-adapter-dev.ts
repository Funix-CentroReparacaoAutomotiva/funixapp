import type { CodaCommercialCandidate, CodaResolution } from './coda-eligibility-dev.ts'
import { resolveCodaCommercialContext } from './coda-eligibility-dev.ts'

/**
 * DEV-only Coda row adapter matching fields observed in the published n8n
 * classifier. This is not wired to the live workflow and performs no I/O.
 *
 * IMPORTANT: fx_UUID has been used by the current n8n workflow as the source
 * message's stable ID. A missing ID means *not confirmed WhatsApp provenance*,
 * and the row must not be imported into the FunixApp just due to phone match.
 */
type CodaRow = Record<string,unknown>
const knownEvent = /^evo:funix_comercial:[A-Za-z0-9:_-]{1,128}$/
const rowPattern = /^i-[A-Za-z0-9_-]{1,100}$/
function fieldName(value:unknown):string {
  if(Array.isArray(value)) return value.map(fieldName).filter(Boolean).join(', ')
  if(value && typeof value==='object'){
    const v=value as Record<string,unknown>
    return fieldName(v.name??v.display??v.value??v.text??v.label??'')
  }
  return typeof value==='string'?value:''
}
export function classifyConfirmedCodaRows(
  input:{remoteJid:string;phoneE164:string|null;suppressed:boolean},
  rows:ReadonlyArray<CodaRow>,
):CodaResolution {
  const mapped:CodaCommercialCandidate[]=[]
  for(const row of rows){
    if(typeof row.id!=='string'||!rowPattern.test(row.id))
      return {kind:'identity_review',reason:'invalid_coda_row'}
    const rawOrigin=typeof row.fx_UUID==='string'?row.fx_UUID.trim():''
    const origin:CodaCommercialCandidate['origin']=
      rawOrigin===''?'manual':knownEvent.test(rawOrigin)?'whatsapp':'unknown'
    const phone=typeof row.funil_contatoE164==='string'?row.funil_contatoE164:''
    mapped.push({
      rowId:row.id,origin,phoneE164:phone,
      commercialStatus:fieldName(row.at_StatusComercial),
      name:fieldName(row.at_Nome??row.name),
      vehicle:fieldName(row.at_Veiculo??row.vehicle),
      plate:fieldName(row.at_Placa??row.plate),
    })
  }
  return resolveCodaCommercialContext({...input,candidates:mapped})
}
