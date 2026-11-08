import type {Atendimento} from '../shared/contracts.ts'

// Only technical terms leave the browser. Never place names, license plates,
// contacts, notes, VINs or unfiltered free-form vehicle descriptions in links.
function technical(value:string,max=80):string|null {
 const text=value.normalize('NFKC').trim().replace(/\s+/g,' ')
 if(!text||text.length>max||! /^[\p{L}\p{N} \-/]+$/u.test(text))return null
 if(/\b(?:\d{7,}|[A-Z]{3}[0-9][A-Z0-9][0-9]{2})\b/i.test(text))return null
 return text
}
function yearFromVehicle(vehicle:string):string {
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
 'hyundai mobis':'hyundai-mobis'
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
export function manualComponentSearchLinks(vehicle:Pick<Atendimento,'brand'|'model'|'vehicle'>,component:string) {
 const brand=technical(vehicle.brand,40),model=technical(vehicle.model,60),part=technical(component,100)
 if(!brand||!model||!part)return null
 const year=yearFromVehicle(vehicle.vehicle)
 const query=[brand,model,year,part].filter(Boolean).join(' ')
 const google=(value:string)=>'https://www.google.com/search?'+new URLSearchParams({tbm:'shop',q:value}).toString()
 const make=brand.toLocaleLowerCase('pt-BR')==='vw'?'volkswagen':brand.toLocaleLowerCase('pt-BR')
 return {general:google(query),original:google(query+' original'),official:officialMarketplaceSearch(make,part),montadora:manufacturerPartsStores[make]?(make==='volkswagen'?manufacturerPartsStores[make]+'todas-categorias?'+new URLSearchParams({q:[part,model,year].filter(Boolean).join(' ')}).toString():manufacturerPartsStores[make]):null}
}
