import type { UpdatePackageProposal, UpdatePackageAction, UpdatePackageMissingField } from '../shared/update-packages.ts'

/**
 * Pure, side-effect-free consolidation of independently prepared fragments.
 * This does NOT ingest a package or authorize any external change.
 * The caller must supply the expected parts for its specific event, after
 * acquiring all of them from trustworthy sources.
 */
export type UpdatePackageFragment = {
  part: string
  proposal: UpdatePackageProposal
}

export type ConsolidatedUpdatePackage = {
  eventKey: string
  proposal: UpdatePackageProposal
}

const allowedParts = new Set(['identity', 'documents', 'commercial'])
const validEventKey = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/

export class PackageConsolidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'PackageConsolidationError'
  }
}
function invalid(code: string, message: string): never {
  throw new PackageConsolidationError(code, message)
}
function validNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
function identical<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Fail closed on missing fragment types, conflicting XP/plate, duplicate action
 * IDs with differing definitions, and inconsistent missing-field definitions.
 * No guessed or inferred identity is promoted to a verified record.
 *
 * expectedParts is explicit: the caller must not omit a relevant part simply
 * to mark an incomplete event ready.
 */
export function consolidateUpdatePackageFragments(
  eventKey: string,
  expectedParts: readonly string[],
  fragments: readonly UpdatePackageFragment[]
): ConsolidatedUpdatePackage {
  if (!validEventKey.test(eventKey) || !expectedParts.length ||
    new Set(expectedParts).size !== expectedParts.length ||
    expectedParts.some(part => !allowedParts.has(part))) {
    invalid('EVENT_INVALID', 'Evento ou composição esperada inválida.')
  }
  if (!fragments.length || fragments.length > expectedParts.length) {
    invalid('EVENT_INCOMPLETE', 'Partes do evento ainda não estão completas.')
  }

  const byPart = new Map<string, UpdatePackageProposal>()
  for (const fragment of fragments) {
    if (!fragment || !expectedParts.includes(fragment.part) || byPart.has(fragment.part) ||
      !fragment.proposal || !Array.isArray(fragment.proposal.actions) ||
      !Array.isArray(fragment.proposal.missingFields)) {
      invalid('FRAGMENT_INVALID', 'Parte repetida ou inválida.')
    }
    byPart.set(fragment.part, fragment.proposal)
  }
  if (expectedParts.some(part => !byPart.has(part))) {
    invalid('EVENT_INCOMPLETE', 'Uma ou mais partes do evento ainda não chegaram.')
  }

  const first = fragments[0]!.proposal
  if (!validNonEmpty(first.sourceReference) ||
    !['gmail', 'whatsapp', 'other'].includes(first.source)) {
    invalid('SOURCE_INVALID', 'Origem do evento inválida.')
  }

  let experienceId: string | null = null
  let plate: string | null = null
  const actions = new Map<string, UpdatePackageAction>()
  const missingFields = new Map<string, UpdatePackageMissingField>()
  const summaries: string[] = []
  for (const { proposal } of fragments) {
    if (proposal.source !== first.source || proposal.sourceReference !== first.sourceReference) {
      invalid('SOURCE_CONFLICT', 'Partes de eventos ou canais diferentes não podem ser reunidas.')
    }
    if (proposal.experienceId) {
      if (experienceId && experienceId !== proposal.experienceId) {
        invalid('IDENTITY_CONFLICT', 'Experiências divergentes para o mesmo evento.')
      }
      experienceId = proposal.experienceId
    }
    if (proposal.plate) {
      if (plate && plate !== proposal.plate) {
        invalid('IDENTITY_CONFLICT', 'Placas divergentes para o mesmo evento.')
      }
      plate = proposal.plate
    }
    if (validNonEmpty(proposal.summary) && !summaries.includes(proposal.summary)) {
      summaries.push(proposal.summary)
    }
    for (const action of proposal.actions) {
      if (!validNonEmpty(action?.id)) invalid('ACTION_INVALID', 'Ação sem identificador.')
      const prior = actions.get(action.id)
      if (prior && !identical(prior, action)) {
        invalid('ACTION_CONFLICT', 'Ações com mesmo identificador e conteúdo divergente.')
      }
      actions.set(action.id, action)
    }
    for (const field of proposal.missingFields) {
      if (!validNonEmpty(field?.key)) invalid('FIELD_INVALID', 'Pendência sem identificador.')
      const prior = missingFields.get(field.key)
      if (prior && !identical(prior, field)) {
        invalid('FIELD_CONFLICT', 'Pendências incompatíveis entre partes do evento.')
      }
      missingFields.set(field.key, field)
    }
  }
  if (!actions.size) invalid('EVENT_EMPTY', 'Evento não contém ações propostas.')

  // A known XP in one fragment cannot silently clear an identity question
  // raised by another. That question must be independently revalidated.
  const title = [experienceId ?? 'XP não identificada', plate].filter(Boolean).join(' · ')
  const proposal: UpdatePackageProposal = {
    source: first.source,
    sourceReference: first.sourceReference,
    experienceId,
    plate,
    title,
    summary: summaries.join(' | ').slice(0, 1000) || 'Revisar alterações propostas',
    actions: [...actions.values()],
    missingFields: [...missingFields.values()]
  }
  if (proposal.actions.length > 40 || proposal.missingFields.length > 15) {
    invalid('EVENT_TOO_LARGE', 'Evento ultrapassa o limite de ações ou pendências.')
  }
  return { eventKey, proposal }
}
