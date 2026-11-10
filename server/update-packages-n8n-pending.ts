import type { UpdatePackageIngest, UpdatePackageProposal } from '../shared/update-packages.ts'
import type { EventInventory } from './update-packages-event.ts'
import type { UpdatePackageFragment } from './update-packages-consolidate.ts'
import { consolidateUpdatePackageFragments } from './update-packages-consolidate.ts'

/**
 * Converts the UNVERIFIED n8n draft into an operator-visible pending package.
 * Importantly, it does not mark the event as reviewed or approved and never
 * performs HTTP, database writes, document archiving or ERP operations.
 */
export type PendingN8nGmailDraft = {
  status: 'PACOTE_UNICO_RASCUNHO_NAO_PUBLICADO'
  send_enabled: false
  upload_permitted: false
  readiness: 'AGUARDANDO_REVALIDACAO_E_APROVACAO_HUMANA'
  eventKey: string
  inventory: EventInventory
  eventManifest: { eventKey: string; expectedParts: string[] }
  fragments: UpdatePackageFragment[]
  proposal: UpdatePackageProposal
}

const expectedParts=['identity','documents','commercial']
const gmailId=/^[0-9a-f]{15,25}$/i
function blocked(reason:string):never {throw new Error('N8N_DRAFT_'+reason)}

export function preparePendingGmailPackage(draft:PendingN8nGmailDraft):UpdatePackageIngest {
  if(!draft || draft.status!=='PACOTE_UNICO_RASCUNHO_NAO_PUBLICADO' ||
    draft.send_enabled!==false || draft.upload_permitted!==false ||
    draft.readiness!=='AGUARDANDO_REVALIDACAO_E_APROVACAO_HUMANA')blocked('FLAGS_INVALID')
  const inv=draft.inventory,manifest=draft.eventManifest
  if(!inv || inv.source!=='gmail' || !gmailId.test(inv.sourceReference) ||
    draft.eventKey!==`gmail:${inv.sourceReference}:v1` ||
    inv.eventKey!==draft.eventKey || inv.bodyReviewed!==false ||
    inv.commercialReviewed!==false || !Array.isArray(inv.attachmentIds) ||
    inv.attachmentIds.length>40 || !Array.isArray(inv.checkedAttachmentIds) ||
    inv.checkedAttachmentIds.length!==0 || new Set(inv.attachmentIds).size!==inv.attachmentIds.length)
    blocked('INVENTORY_INVALID')
  if(!manifest || manifest.eventKey!==draft.eventKey ||
    !Array.isArray(manifest.expectedParts) ||
    JSON.stringify(manifest.expectedParts)!==JSON.stringify(expectedParts) ||
    !Array.isArray(draft.fragments) || draft.fragments.length!==expectedParts.length)
    blocked('MANIFEST_INVALID')
  const result=consolidateUpdatePackageFragments(draft.eventKey,expectedParts,draft.fragments)
  if(!draft.proposal || draft.proposal.source!==result.proposal.source ||
    draft.proposal.sourceReference!==result.proposal.sourceReference ||
    draft.proposal.experienceId!==result.proposal.experienceId ||
    draft.proposal.plate!==result.proposal.plate ||
    JSON.stringify(draft.proposal.actions)!==JSON.stringify(result.proposal.actions) ||
    JSON.stringify(draft.proposal.missingFields)!==JSON.stringify(result.proposal.missingFields))
    blocked('PROPOSAL_MISMATCH')
  const commercial=draft.fragments.find(f=>f.part==='commercial')!.proposal
  if(!commercial.missingFields.some(f=>f.key==='commercialReview') ||
    draft.proposal.actions.some(a=>a.type==='erp_update'))blocked('COMMERCIAL_UNVERIFIED')
  // All of these actions remain proposals; the backend rejects approval while
  // commercialReview is still unresolved. Clarification reopens revalidation.
  return {
    eventKey:draft.eventKey,
    proposal:{
      ...result.proposal,
      title:result.proposal.title.slice(0,200),
      summary:result.proposal.summary.slice(0,1000)
    }
  }
}
