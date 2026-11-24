export function normalizePhone(phone: string): string | null {
  const clean = phone.replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(clean) ? clean : null
}

/** One canonical identity key for unambiguous full numbers.
 * For Brazil, accept national DDD+subscriber, 55+DDD+subscriber,
 * trunk 0+DDD+subscriber and trunk 0+CSP(2 digits)+DDD+subscriber.
 * Do not infer a missing DDD, add the ninth digit, or shorten a number.
 */
export function normalizeCustomerPhone(raw:string):string|null {
  const exact=normalizePhone(raw)
  if(exact&&!exact.startsWith('+55'))return exact
  const value=raw.trim()
  if(value.startsWith('+')&&!exact)return null
  if(!/^[0-9\s().-]+$/.test(exact?.slice(1)??value))return null
  const digits=(exact?.slice(1)??value).replace(/[\s().-]/g,'')
  let national:string
  if((digits.length===12||digits.length===13)&&digits.startsWith('55'))
    national=digits.slice(2)
  else if(digits.startsWith('0')&&(digits.length===11||digits.length===12))
    national=digits.slice(1)
  else if(digits.startsWith('0')&&(digits.length===13||digits.length===14)&&/^[1-9]\d$/.test(digits.slice(1,3)))
    national=digits.slice(3)
  else
    national=digits
  if(exact&&national===digits)return null
  const ddd=/^(?:1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[134579]|8[1-9]|9[1-9])$/
  if(!ddd.test(national.slice(0,2))||!/^(?:[2-5]\d{7}|9\d{8})$/.test(national.slice(2)))return null
  return '+55'+national
}
