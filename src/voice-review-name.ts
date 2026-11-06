// Display only: never normalize the catalog, transcript or persisted component.
const acronyms=new Set('LED ABS ECU EGR DPF TDI TSI GNV SUV OEM PPF DRL SRS EPS ESP CVT DSG AT MT OE VW'.split(' '))
export function voiceReviewName(value:string){
 let first=true
 return value.replace(/[\p{L}\p{N}]+(?:[./,_-][\p{L}\p{N}]+)*/gu,token=>{
  const technical=acronyms.has(token.toUpperCase())||/\p{L}/u.test(token)&&/\p{N}/u.test(token)
  const result=technical?token:token.toLocaleLowerCase('pt-BR')
  if(!/\p{L}/u.test(token))return result
  const initial=first;first=false
  return initial&&!technical?result.replace(/\p{L}/u,c=>c.toLocaleUpperCase('pt-BR')):result
 })
}
