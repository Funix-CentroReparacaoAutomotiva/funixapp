/** Calendar date only; never derive from a duration or convert through local timezone. */
export function validDeliveryDate(value:unknown):value is string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false
  const parsed=new Date(value+'T00:00:00.000Z')
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value
}
export function deliveryDateLabel(value:string|null|undefined):string {
  return validDeliveryDate(value)?value.split('-').reverse().join('/'):'—'
}
