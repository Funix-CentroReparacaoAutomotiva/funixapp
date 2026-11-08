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
const officialStores:Record<string,string>={
 // Marketplace channel, not the automaker-owned parts e-commerce.
 volkswagen:'https://www.mercadolivre.com.br/loja/volkswagen/pecas-e-acessorios',
 chevrolet:'https://www.mercadolivre.com.br/a/store/chevrolet-loja-oficial',
 fiat:'https://www.mercadolivre.com.br/loja/fiat',
 jeep:'https://www.mercadolivre.com.br/loja/jeep',
 ford:'https://www.mercadolivre.com.br/a/store/ford-loja-oficial',
 renault:'https://www.mercadolivre.com.br/loja/renault'
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
 return {general:google(query),original:google(query+' original'),official:officialStores[make]??null,montadora:manufacturerPartsStores[make]?(make==='volkswagen'?manufacturerPartsStores[make]+'todas-categorias?'+new URLSearchParams({q:[part,model,year].filter(Boolean).join(' ')}).toString():manufacturerPartsStores[make]):null}
}
