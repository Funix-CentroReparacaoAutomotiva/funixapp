export function normalizePhone(phone: string): string | null {
  const clean = phone.replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(clean) ? clean : null
}

/** Only complete Brazilian national numbers or explicit country code without '+'.
 * Never add a subscriber digit, guess DDD, strip extensions, or repair a different number.
 */
export function normalizeCustomerPhone(raw:string):string|null {
  const exact=normalizePhone(raw)
  if(exact && !exact.startsWith('+55'))return exact
  if(raw.trim().startsWith('+')&&!exact)return null
  if(!/^[0-9\s().-]+$/.test(exact?.slice(1)??raw.trim()))return null
  const digits=(exact?.slice(1)??raw).replace(/[\s().-]/g,'')
  const national=(digits.length===12||digits.length===13)&&digits.startsWith('55')?digits.slice(2):digits
  if(exact&&national===digits)return null
  const ddd=/^(?:1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[134579]|8[1-9]|9[1-9])$/
  if(!ddd.test(national.slice(0,2))||! /^(?:[2-5]\d{7}|9\d{8})$/.test(national.slice(2)))return null
  return '+55'+national
}
