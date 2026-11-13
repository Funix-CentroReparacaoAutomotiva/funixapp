// Formatação visual apenas: não verifica identidade nem modifica o telefone normalizado do backend.
export function formatPhoneDraft(value: string): string {
  // DDI explícito, caracteres não numéricos desconhecidos e números longos
  // continuam intactos para não apagar cadastros internacionais/legados.
  if (value.trimStart().startsWith('+') || /[^\d\s().-]/.test(value)) return value
  const digits = value.replace(/\D/g, '')
  if (digits.length > 11) return value
  if (!digits) return ''
  if (digits.length <= 2) return '(' + digits
  const area = digits.slice(0, 2)
  const subscriber = digits.slice(2)
  const prefix = subscriber.length > 8 ? 5 : 4
  const local = subscriber.length > prefix
    ? subscriber.slice(0, prefix) + '-' + subscriber.slice(prefix)
    : subscriber
  return '(' + area + ') ' + local
}

// Mantém a posição lógica entre os dígitos na edição/colagem.
export function phoneCursorPosition(formatted: string, digitsBeforeCaret: number): number {
  if (digitsBeforeCaret <= 0) return 0
  let seen = 0
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i]!)) seen++
    if (seen === digitsBeforeCaret) return i + 1
  }
  return formatted.length
}
