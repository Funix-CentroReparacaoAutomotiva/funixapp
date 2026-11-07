/** Issue #71 / PR #83: proposed policy, synthetic only; no routes, DB, provider or env. */
export type Permission = 'chat.inbox.read' | 'chat.history.read_full' | 'chat.links.manage' | 'chat.audit.read'
export type Principal = Readonly<{
  authenticated: boolean
  individualId: string | null
  permissions: readonly Permission[]
  instances: readonly string[]
  visibleAttendances: readonly string[]
}>
export type Conversation = Readonly<{ id: string; instance: string; linkedAttendances: readonly string[] }>
export type Decision = 'allow' | 'unauthenticated' | 'denied'

function eligible(principal: Principal, conversation: Conversation): boolean {
  return principal.authenticated && !!principal.individualId &&
    principal.instances.includes(conversation.instance)
}

/** Atendimento access never promotes itself into full conversation-read authority. */
export function canReadConversation(principal: Principal, conversation: Conversation): Decision {
  if (!principal.authenticated) return 'unauthenticated'
  if (!eligible(principal, conversation)) return 'denied'
  return principal.permissions.includes('chat.history.read_full') ? 'allow' : 'denied'
}

/** Explicit grant and target Attendance visibility are both required. */
export function canManageLink(principal: Principal, conversation: Conversation, atendimentoId: string): Decision {
  if (!principal.authenticated) return 'unauthenticated'
  if (!eligible(principal, conversation)) return 'denied'
  if (!principal.permissions.includes('chat.links.manage')) return 'denied'
  return principal.visibleAttendances.includes(atendimentoId) ? 'allow' : 'denied'
}

/** Context selection is navigation, not linkage or a privilege grant. */
export function canSelectContext(principal: Principal, conversation: Conversation, atendimentoId: string): Decision {
  if (!principal.authenticated) return 'unauthenticated'
  if (!eligible(principal, conversation)) return 'denied'
  return conversation.linkedAttendances.includes(atendimentoId) &&
    principal.visibleAttendances.includes(atendimentoId) ? 'allow' : 'denied'
}

/** Resolves only an opaque conversation ID. No client-supplied provider JID. */
export function authorizedReadRequest(principal: Principal, conversation: Conversation):
  { ok: true; conversationId: string } | { ok: false; reason: Decision } {
  const decision = canReadConversation(principal, conversation)
  return decision === 'allow' ? { ok: true, conversationId: conversation.id } : { ok: false, reason: decision }
}
