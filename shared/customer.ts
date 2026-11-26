export type ReferenceKind = 'person' | 'contact' | 'vehicle' | 'payer'
export type CustomerReference = {
  id: string | null
  text: string
  entityId?: string|null
  /** Stable grouping key for a participant draft; never an ownership credential. */
  participantKey?: string
  brand?: string
  model?: string
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
export type ContactAvailability = {
  state: 'pending' | 'available' | 'unavailable' | 'conflict' | 'incomplete' | 'history_only'
  checkedAt: string | null
  conversationId: string | null
  observedPhone?: string
}
export type EntityContact = CustomerRecord & {whatsapp: ContactAvailability}
export type EntityRecord = CustomerRecord & {contacts: EntityContact[]}
export type EntityContactInput = {id?: string; text: string; revision?: number}
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

/** Legacy transport stays flat for compatibility; the editing domain is grouped.
 * Canonical contact ownership wins. Unassigned legacy rows remain visible for
 * review rather than being assigned by array position.
 */
export function participantGroups(refs:CustomerReferences) {
  const groups=refs.person.map((person,index)=>({
    person,index,key:person.participantKey??(person.id?'entity:'+person.id:'legacy:'+index),
    contacts:[] as Array<{contact:CustomerReference;index:number}>
  }))
  const unassigned:Array<{contact:CustomerReference;index:number}>=[]
  refs.contact.forEach((contact,index)=>{
    const owner=contact.entityId
    const candidates=contact.participantKey?
      groups.filter(g=>g.key===contact.participantKey&&(!owner||!g.person.id||g.person.id===owner)):
      owner?groups.filter(g=>g.person.id===owner):
      groups.length===1?[groups[0]!]:[]
    if(candidates.length===1)candidates[0]!.contacts.push({contact,index})
    else unassigned.push({contact,index})
  })
  return {groups,unassigned}
}

/** Add explicit grouping to an edit without changing IDs or guessing among
 * several possible owners. Old orphan rows stay untouched for review. */
export function groupedCustomerReferences(refs:CustomerReferences):CustomerReferences {
  const {groups,unassigned}=participantGroups(refs)
  const person=groups.map(g=>({...g.person,participantKey:g.key}))
  const contact=refs.contact.map(c=>({...c}))
  for(const g of groups)for(const item of g.contacts)
    contact[item.index]={...item.contact,participantKey:g.key}
  for(const item of unassigned) {
    const {participantKey,...legacy}=item.contact
    void participantKey
    contact[item.index]=legacy
  }
  return {...refs,person,contact}
}

/** A grouping/label edit does not change the recipient. Preserve the order
 * because the first selected contact still matters to the legacy send context. */
export function contactSelectionKey(contacts:CustomerReference[]|undefined) {
  return JSON.stringify((contacts??[]).filter(c=>c.id||c.text.trim()).map(c=>c.id?'id:'+c.id:'text:'+c.text.trim()))
}
