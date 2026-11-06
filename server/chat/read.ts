import type { ChatRepository } from './repository.ts'
import { ServiceError } from '../errors.ts'

/** Called only after the application's session check. No identity inference or writes. */
export function readMessages(chat: ChatRepository, id: string, query: URLSearchParams) {
  const invalid = () => { throw new ServiceError(400, 'CHAT_INVALID_QUERY', 'Parâmetros de leitura do Chat inválidos.') }
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return invalid()
  if ([...query.keys()].some(key => !['limit', 'cursor'].includes(key)) ||
    query.getAll('limit').length > 1 || query.getAll('cursor').length > 1) return invalid()
  const limit = query.get('limit') ?? '50', cursor = query.get('cursor') ?? undefined
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(limit) ||
    (cursor !== undefined && (!/^[A-Za-z0-9_-]{1,600}$/.test(cursor)))) return invalid()
  try { return chat.messages(id, { limit: Number(limit), cursor }) }
  catch (cause) {
    if (cause instanceof ServiceError && cause.status === 422) return invalid()
    throw cause
  }
}
