import type { UpdatePackage } from '../shared/update-packages.ts'
import { consolidateUpdatePackageFragments } from './update-packages-consolidate.ts'
import type { UpdatePackageFragment, ConsolidatedUpdatePackage } from './update-packages-consolidate.ts'

/**
 * Strict handoff boundary between extraction (n8n) and consolidation.
 * Does not verify external sources itself. The upstream inventory producer must
 * enumerate ALL attachment IDs and confirm that the email/message body was read.
 * No ingestion, HMAC signature, network request or external writes occur here.
 */
export type EventInventory = {
  eventKey: string
  source: UpdatePackage['source']
  sourceReference: string
  bodyReviewed: boolean
  commercialReviewed: boolean
  attachmentIds: string[]
  checkedAttachmentIds: string[]
}

export type EventPreparation = {
  inventory: EventInventory
  fragments: UpdatePackageFragment[]
}

export class EventPreparationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'EventPreparationError'
  }
}
function reject(code: string, detail: string): never { throw new EventPreparationError(code, detail) }
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$/
const requiredParts = ['identity', 'documents', 'commercial'] as const

/**
 * A package is only considered structurally complete once the source inventory
 * is explicitly reconciled and all three parts are present. An empty commercial
 * fragment is permitted after the body is reviewed (no commercial action found),
 * not before. External verification is still required before ingest.
 */
export function prepareCompleteUpdateEvent(input: EventPreparation): ConsolidatedUpdatePackage {
  if (!input || !input.inventory || !Array.isArray(input.fragments)) {
    reject('INVENTORY_INVALID', 'Inventário ausente.')
  }
  const v=input.inventory
  if (!identifier.test(v.eventKey) || !identifier.test(v.sourceReference) ||
    !['gmail','whatsapp','other'].includes(v.source) ||
    v.eventKey !== `${v.source}:${v.sourceReference}:v1`) {
    reject('INVENTORY_IDENTITY_INVALID', 'Identidade do evento incompatível com a origem.')
  }
  if (v.bodyReviewed !== true || v.commercialReviewed !== true) {
    reject('EVENT_NOT_REVIEWED', 'Corpo da mensagem e dados comerciais ainda não revisados.')
  }
  if (!Array.isArray(v.attachmentIds) || !Array.isArray(v.checkedAttachmentIds) ||
    v.attachmentIds.length>40 || v.checkedAttachmentIds.length>40 ||
    [...v.attachmentIds,...v.checkedAttachmentIds].some(id=>typeof id!=='string'||!identifier.test(id)) ||
    new Set(v.attachmentIds).size!==v.attachmentIds.length ||
    new Set(v.checkedAttachmentIds).size!==v.checkedAttachmentIds.length ||
    v.attachmentIds.length!==v.checkedAttachmentIds.length ||
    v.attachmentIds.some(id=>!v.checkedAttachmentIds.includes(id))) {
    reject('ATTACHMENTS_INCOMPLETE', 'Anexos não inventariados ou não conferidos integralmente.')
  }
  if (input.fragments.length!==requiredParts.length) {
    reject('FRAGMENTS_INCOMPLETE', 'Identificação, documentos e informações comerciais são obrigatórios.')
  }
  if (input.fragments.some(f => f.proposal?.source!==v.source ||
    f.proposal?.sourceReference!==v.sourceReference)) {
    reject('FRAGMENT_ORIGIN_CONFLICT', 'Fragmento não corresponde ao evento inventariado.')
  }
  return consolidateUpdatePackageFragments(v.eventKey,requiredParts,input.fragments)
}
