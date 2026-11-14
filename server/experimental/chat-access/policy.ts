/** Issue #71: pure single-operator, synthetic policy sketch. Not wired to routes or Evolution. */
export type Session = Readonly<{ authenticated: boolean }>
export type Conversation = Readonly<{
  id: string
  instance: string
  linkedAttendances: readonly string[]
}>
export type Decision = 'allow' | 'unauthenticated' | 'out_of_scope' | 'not_linked'

/** Server-controlled instance; never read this from untrusted URL/body. */
export function canReadConversation(
  session: Session,
  conversation: Conversation,
  configuredInstance: string,
): Decision {
  if (!session.authenticated) return 'unauthenticated'
  return conversation.instance === configuredInstance ? 'allow' : 'out_of_scope'
}

/** Linking requires a valid session and a known provider-side conversation. */
export function canManageLink(
  session: Session,
  conversation: Conversation,
  configuredInstance: string,
): Decision {
  return canReadConversation(session, conversation, configuredInstance)
}

/** Changing commercial context is not a new provider request and never creates a link. */
export function canSelectContext(
  session: Session,
  conversation: Conversation,
  configuredInstance: string,
  atendimentoId: string,
): Decision {
  const authorized = canReadConversation(session, conversation, configuredInstance)
  if (authorized !== 'allow') return authorized
  return conversation.linkedAttendances.includes(atendimentoId) ? 'allow' : 'not_linked'
}

export function authorizedReadRequest(
  session: Session,
  conversation: Conversation,
  configuredInstance: string,
): { ok: true; conversationId: string } | { ok: false; reason: Decision } {
  const decision = canReadConversation(session, conversation, configuredInstance)
  return decision === 'allow'
    ? { ok: true, conversationId: conversation.id }
    : { ok: false, reason: decision }
}
