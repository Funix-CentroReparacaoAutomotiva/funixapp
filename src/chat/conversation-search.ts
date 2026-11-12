import type { ConversationRow } from './evolution-read-model'

/** Display-only search among pages already retrieved from the authenticated API.
 * Names here are labels, never evidence of a customer's identity or linkage.
 */
export function filterLoadedConversations(rows: readonly ConversationRow[], searchTerm: string): ConversationRow[] {
  const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim().replace(/\s+/g, ' ')
  const term = normalize(searchTerm)
  if (!term) return [...rows]
  const phoneTerm = searchTerm.replace(/\D/g, '')
  return rows.filter(row =>
    (row.displayName !== null && normalize(row.displayName).includes(term)) ||
    (phoneTerm.length >= 2 && row.phoneNumber !== null && row.phoneNumber.includes(phoneTerm)),
  )
}
