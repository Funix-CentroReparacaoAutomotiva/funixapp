import type {Atendimento} from '../shared/contracts.ts'

// Only technical terms leave the browser. Never place names, license plates,
// contacts, notes, VINs or unfiltered free-form vehicle descriptions in links.
function technical(value:string,max=80,allowPartPunctuation=false):string|null {
 const text=value.normalize('NFKC').trim().replace(/\s+/g,' ')
 if(!text||text.length>max||!(allowPartPunctuation ? /^[\p{L}\p{N} \-/()%.,+&#]+$/u : /^[\p{L}\p{N} \-/]+$/u).test(text))return null
 // Descriptions can be pasted from messages. Reject recognizable personal identifiers
 // even when a phone or plate uses normal separators; search URLs leave FUNIX.
 if(/\b\d{7,}\b/.test(text))return null
 if(/\b[A-Z]{3}[ -]?\d[ -]?[A-Z\d][ -]?\d{2}\b/i.test(text))return null
 if(/\b[A-HJ-NPR-Z0-9]{17}\b/i.test(text))return null
 // Formatted taxpayer identifiers must never be sent to external shopping/search sites.
 if(/\b\d{3}[. -]\d{3}[. -]\d{3}[- ]?\d{2}\b/.test(text))return null
 if(/\b\d{2}[. -]\d{3}[. -]\d{3}[\/-]\d{4}[- ]?\d{2}\b/.test(text))return null
 if(/(?<!\d)(?:\+?55[ ().-]*)?\(?\d{2}\)?[ ().-]+\d{4,5}[ .-]*\d{4}(?!\d)/.test(text))return null
 return text
}
function yearFromVehicle(vehicle:string):string {
 // Fabrication/model year (2019/2020): search by the model year, not the older fabrication year.
 const pairs=[...vehicle.matchAll(/\b(?:19\d{2}|20\d{2})\s*\/\s*(19\d{2}|20\d{2})\b/g)]
 if(pairs.length===1)return pairs[0]![1]!
 const matches=[...vehicle.matchAll(/\b(?:19[89]\d|20[0-3]\d)\b/g)].map(m=>m[0])
 return matches.length===1?matches[0]!:''
}
// Store-scoped search routes observed in the examples supplied by the operator.
// These are store slugs, NOT generic marketplace search filters.
const marketplaceStoreSlugs:Record<string,string>={
 volkswagen:'volkswagen',
 chevrolet:'chevrolet',
 fiat:'fiat',
 jeep:'jeep',
 hyundai:'hyundai-mobis',
 'hyundai mobis':'hyundai-mobis',
 citroen:'citroen',
 peugeot:'peugeot',
 ram:'ram',
 ford:'ford',
 renault:'renault',
 audi:'audi'
}
function searchSlug(value:string):string {
 return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')
}
function officialMarketplaceSearch(make:string,part:string):string|null {
 const store=marketplaceStoreSlugs[make]
 if(!store)return null
 const item=searchSlug(part)
 return item?'https://lista.mercadolivre.com.br/loja/'+store+'/'+item+'?sb=storefront_url':null
}
// Only add a fourth button for verified, automaker-backed online parts sales.
// Institutional catalogs and independent dealers do not qualify.
const manufacturerPartsStores:Record<string,string>={
 volkswagen:'https://pecas.vw.com.br/'
}
export type ComponentSearchContext={pieceName:string;position?:string}
// Context comes exclusively from the commercial catalog (not from customer notes).
// Existing two-argument calls retain their legacy behavior for compatibility.
export function manualComponentSearchLinks(vehicle:Pick<Atendimento,'brand'|'model'|'vehicle'>,component:string,context?:ComponentSearchContext) {
 const brand=technical(vehicle.brand,40),model=technical(vehicle.model,60),part=technical(component,100,true)
 const piece=context?technical(context.pieceName,100,true):null
 const position=context?.position?.trim()?technical(context.position,40):null
 if(!brand||!model||!part||(context&&!piece)||(context?.position?.trim()&&!position))return null
 // Catalog names sometimes already contain the side. Do not repeat "Passageiro".
 const pieceWithPosition=piece&&position&&!piece.toLocaleLowerCase('pt-BR').includes(position.toLocaleLowerCase('pt-BR'))
   ?piece+' '+position:piece
 const year=context? '':yearFromVehicle(vehicle.vehicle)
 const terms=[brand,model,year,pieceWithPosition,part].filter(Boolean)
 const query=terms.join(' ')
 const google=(value:string)=>'https://www.google.com/search?'+new URLSearchParams({tbm:'shop',q:value}).toString()
 const normalizedBrand=brand.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
 const make=normalizedBrand==='vw'?'volkswagen':normalizedBrand
 const storeTerm=[model,year,pieceWithPosition,part].filter(Boolean).join(' ')
 return {general:google(query),original:google(query+' original'),official:officialMarketplaceSearch(make,storeTerm),montadora:manufacturerPartsStores[make]?(make==='volkswagen'?manufacturerPartsStores[make]+'todas-categorias?'+new URLSearchParams({q:storeTerm}).toString():manufacturerPartsStores[make]):null}
}
