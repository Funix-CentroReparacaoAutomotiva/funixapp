/**
 * Development reference for choosing an ERP/Coda commercial case.
 * Actual Coda rows must carry a verified source before this policy is used.
 * Do not deploy this helper as a substitute for the current n8n classifier.
 */
export type CodaCommercialCandidate = {
  rowId: string
  origin: 'whatsapp' | 'manual' | 'unknown'
  commercialStatus: string
  phoneE164: string
  name: string
  vehicle: string
  plate: string
}
export type CodaResolution =
  | { kind:'direct'; codaRowId:string }
  | { kind:'create'; reason:'new'|'all_closed' }
  | { kind:'choose'; candidates: Array<Pick<CodaCommercialCandidate,'rowId'|'name'|'vehicle'|'plate'|'commercialStatus'>> }
  | { kind:'identity_review'|'suppressed'; reason:string }

const closed = new Set(['orcamento rejeitados','fim negativo','fim positivo'])
function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()
}
export function resolveCodaCommercialContext(input: {
  phoneE164: string | null
  remoteJid: string
  suppressed: boolean
  candidates: CodaCommercialCandidate[]
}): CodaResolution {
  if(input.suppressed) return {kind:'suppressed',reason:'commercial_opt_out'}
  if(!input.phoneE164 || !/^\+[1-9]\d{7,14}$/.test(input.phoneE164) ||
     input.remoteJid !== input.phoneE164.slice(1)+'@s.whatsapp.net')
    return {kind:'identity_review',reason:'unverified_identity'}
  const seen = new Set<string>()
  for(const candidate of input.candidates){
    if(!/^i-[A-Za-z0-9_-]{1,100}$/.test(candidate.rowId) || seen.has(candidate.rowId))
      return {kind:'identity_review',reason:'invalid_or_duplicate_row'}
    seen.add(candidate.rowId)
    if(candidate.phoneE164!==input.phoneE164) return {kind:'identity_review',reason:'phone_conflict'}
  }
  // A record whose origin cannot be verified must not become a commercial case
  // automatically: especially important for manual ERP records.
  if(input.candidates.some(x=>x.origin==='unknown'))
    return {kind:'identity_review',reason:'unknown_record_origin'}
  const whatsapp = input.candidates.filter(x=>x.origin==='whatsapp')
  if(whatsapp.some(x=>!normalize(x.commercialStatus)))
    return {kind:'identity_review',reason:'unknown_commercial_status'}
  const open = whatsapp.filter(x=>!closed.has(normalize(x.commercialStatus)))
  if(open.length===1) return {kind:'direct',codaRowId:open[0]!.rowId}
  if(open.length>1) return {kind:'choose',candidates:open.map(x=>({
    rowId:x.rowId,name:x.name,vehicle:x.vehicle,plate:x.plate,commercialStatus:x.commercialStatus,
  }))}
  return {kind:'create',reason:whatsapp.length?'all_closed':'new'}
}
