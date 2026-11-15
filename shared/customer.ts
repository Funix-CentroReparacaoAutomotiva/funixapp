export type ReferenceKind = 'person' | 'contact' | 'vehicle' | 'payer'
export type CustomerReference = {
  id: string | null
  text: string
  plate?: string
  fabricationYear?: string | null
  modelYear?: string | null
}
export type CustomerReferences = Record<ReferenceKind, CustomerReference[]>
export type CustomerRecord = CustomerReference & {
  id: string
  kind: 'entity' | 'contact' | 'vehicle'
  revision: number
  nickname?: string
  entityId?: string | null
  conversationId?: string | null
  channelState?: 'informed' | 'observed' | 'response_received'
}
export type NamePart = { name: string; entityId: string | null }
export type CommercialConversation = {
  contactId?: string
  names: NamePart[]
  atendimentoCount: number
  preview: string | null
  profilePhoto: string | null
}
export function conversationNames(own: string | null, entityId: string | null, people: NamePart[]): NamePart[] {
  if (own?.trim()) return [{ name: own.trim(), entityId }]
  const parts: NamePart[] = [], seen = new Set<string>()
  for (const person of people) {
    const name = person.name.trim()
    const key = person.entityId ? 'id:' + person.entityId : 'name:' + name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
    if (!name || seen.has(key)) continue
    seen.add(key); parts.push({ name, entityId: person.entityId })
  }
  return parts.length ? parts : [{ name: 'Sem nome', entityId: null }]
}
