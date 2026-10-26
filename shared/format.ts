// Presentation only: preserve every exact decimal digit, including fractional cents.
export function money(value:string|null|undefined):string {
 if(value===null || value===undefined)return 'Indisponível'
 const negative=value.startsWith('-'),[whole,fraction='']=(negative?value.slice(1):value).split('.')
 return `${negative?'-':''}R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')},${fraction.padEnd(2,'0')}`
}
