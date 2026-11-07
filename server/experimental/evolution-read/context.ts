// Pure experimental V20 state model. No persistence, auth, inference or production imports.
export type ConversationRef = Readonly<{ conversationId: string; instance: string; remoteJid: string }>
export class ConversationContextPoc {
  private readonly conversations = new Map<string, ConversationRef>()
  private readonly atendimentos: Set<string>
  private readonly links = new Map<string, Set<string>>()
  private readonly activeByChat = new Map<string, string>()
  private selected: string | null = null
  constructor(conversations: ConversationRef[], atendimentos: string[]) {
    this.atendimentos = new Set(atendimentos)
    const identities = new Set<string>()
    for (const c of conversations) {
      const identity = JSON.stringify([c.instance, c.remoteJid])
      if (!c.conversationId || !c.instance || !c.remoteJid || identities.has(identity) || this.conversations.has(c.conversationId)) throw new Error('Invalid conversation model')
      identities.add(identity); this.conversations.set(c.conversationId, { ...c }); this.links.set(c.conversationId, new Set())
    }
  }
  private conversation(id: string): ConversationRef {
    const c = this.conversations.get(id)
    if (!c) throw new Error('Unknown conversation')
    return { ...c }
  }
  link(conversationId: string, atendimentoId: string): void {
    this.conversation(conversationId)
    if (!this.atendimentos.has(atendimentoId)) throw new Error('Unknown atendimento')
    this.links.get(conversationId)!.add(atendimentoId)
  }
  unlink(conversationId: string, atendimentoId: string): void {
    this.conversation(conversationId); this.links.get(conversationId)!.delete(atendimentoId)
    if (this.activeByChat.get(conversationId) === atendimentoId) this.activeByChat.delete(conversationId)
  }
  selectConversation(conversationId: string): void { this.conversation(conversationId); this.selected = conversationId }
  selectAtendimento(atendimentoId: string): void {
    if (!this.selected || !this.links.get(this.selected)!.has(atendimentoId)) throw new Error('Context requires explicit link')
    this.activeByChat.set(this.selected, atendimentoId)
  }
  context(): { conversation: ConversationRef | null; atendimentoId: string | null } {
    return { conversation: this.selected ? this.conversation(this.selected) : null,
      atendimentoId: this.selected ? this.activeByChat.get(this.selected) ?? null : null }
  }
  conversationsFor(atendimentoId: string): ConversationRef[] {
    return [...this.links].filter(([, ids]) => ids.has(atendimentoId)).map(([id]) => this.conversation(id))
  }
  atendimentosFor(conversationId: string): string[] { this.conversation(conversationId); return [...this.links.get(conversationId)!] }
}
