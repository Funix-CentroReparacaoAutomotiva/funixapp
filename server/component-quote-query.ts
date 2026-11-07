import type{QuoteQuery}from'../shared/component-quote.ts'
const normalized=(v:string)=>v.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
export const normalizeQuote=normalized
const models:Record<string,string[]>={volkswagen:['gol','polo','fox','saveiro','voyage','virtus','t cross','nivus'],chevrolet:['onix','prisma','cobalt','s10','tracker','spin'],fiat:['argo','strada','uno','mobi','toro','palio'],hyundai:['hb20','hb20s','creta'],ford:['ka','fiesta','ecosport','ranger'],jeep:['renegade','compass'],renault:['sandero','logan','kwid','duster']}
const parts=new Set('farol parachoque macaneta vidro guia presilha suporte dianteiro dianteira traseiro traseira esquerdo esquerda direito direita externo externa interno interna porta paralama parabarro fixacao cobertura superior inferior halogeno led manual eletrico negro negra cromado'.split(' '))
const connecting=new Set('de da do das dos para e a o'.split(' '))
// Fail closed, then project ONLY a controlled vocabulary. Never forward arbitrary
// names/vehicle strings, even if they contain a legitimate component word.
const sensitive=(s:string)=>s.length>200||/[<>@:/\\]|\b(?:placa|chassi|vin|cpf|cnpj|telefone|whatsapp|cliente|ignore|instrucoes|token)\b/i.test(s)||/\b[A-Z]{3}[-]?\d[A-Z\d]\d{2}\b/i.test(s)||/\d[\d ().+-]{7,}\d/.test(s)||/\b[A-HJ-NPR-Z0-9]{17}\b/i.test(s)
function technical(raw:string,catalogParent=false):string|null{
 if(sensitive(raw))return null
 const tokens=normalized(raw).replace(/para choque/g,'parachoque').replace(/para lama/g,'paralama').replace(/para barro/g,'parabarro').split(' ')
 const catalogSide=(w:string)=>w==='motorista'||w==='passageiro'
 if(!tokens.length||tokens.some(w=>!parts.has(w)&&!connecting.has(w)&&!(catalogParent&&catalogSide(w))))return null
 // The Brazilian FUNIX catalog names sides as motorista/passageiro.
 // Translate only the catalog parent; the requested component must still specify its own side.
 return tokens.filter(w=>parts.has(w)||(catalogParent&&catalogSide(w))).map(w=>catalogParent&&w==='motorista'?'esquerdo':catalogParent&&w==='passageiro'?'direito':w).join(' ')
}
export function saneQuoteQuery(input:{brand:string;model:string;vehicle:string;component:string;parent:string}):QuoteQuery|null{
 const brand=normalized(input.brand)==='vw'?'volkswagen':normalized(input.brand)
 if(!models[brand]||sensitive(input.model)||sensitive(input.vehicle))return null
 const known=models[brand].filter(m=>(' '+normalized(input.model)+' ').includes(' '+m+' '))
 if(known.length!==1)return null
 const component=technical(input.component),parent=technical(input.parent,true)
 if(!component||!parent)return null
 const all=component+' '+parent,left=/\besquerd[oa]\b/.test(all),right=/\bdireit[oa]\b/.test(all)
 if(left&&right)return null
 const side=left?'esquerdo':right?'direito':null
 if(/\b(farol|macaneta|vidro|guia)\b/.test(component)&&!side)return null
 const years=[...new Set((input.vehicle+' '+input.model).match(/\b(?:19[89]\d|20[0-2]\d|2030)\b/g)??[])]
 if(years.length>1)return null
 return{brand,model:known[0]!,year:years.length===1?Number(years[0]):null,component,parent,side}
}
