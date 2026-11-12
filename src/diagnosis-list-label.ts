import type { DiagnosisIntensity } from '../shared/commercial'

/** Formata somente a apresentação; nunca modifica IDs ou nomes persistidos. */
export function diagnosisListLabel(pieceName: string, diagnosisName: string | null, intensity: DiagnosisIntensity | null | undefined) {
  const piece = pieceName.replace(/\s*·\s*/g, ' ').replace(/\b(Motorista|Passageiro)\b/g, term => term.toLocaleLowerCase('pt-BR'))
  if (!diagnosisName) return { piece, diagnosis: 'Diagnóstico pendente' }
  const trimmed = diagnosisName.trim()
  const diagnosis = /^[A-Z\d]{2,}(?:\b|$)/.test(trimmed)
    ? trimmed
    : trimmed.replace(/^\p{Lu}/u, letter => letter.toLocaleLowerCase('pt-BR'))
  return { piece, diagnosis: intensity ? diagnosis + ' ' + intensity : diagnosis }
}
