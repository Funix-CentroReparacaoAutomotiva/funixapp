import {money} from './money'

export function todayInSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export function decimal(cents: number | bigint) {
  const units = BigInt(cents)
  return `${units / 100n}.${(units % 100n).toString().padStart(2, '0')}`
}

export function currency(cents: number | bigint) {
  return money(decimal(cents))
}

export function inputCents(input: string) {
  const clean = input.trim()
  const valid = /^(?:\d+(?:[,.]\d{1,2})?|\d{1,3}(?:\.\d{3})+,\d{1,2})$/.test(clean)
  if (!valid) return null
  const [whole, fraction = ''] = (clean.includes(',') ? clean.replaceAll('.', '').replace(',', '.') : clean).split('.')
  const cents = Number(whole + fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}
