// Customer-facing text only: never rewrite catalog/diagnosis/snapshot values.
import type{DiagnosisIntensity}from'../shared/commercial.ts'
// Lowercase known common automotive/Portuguese terms only. Unknown spelling is
// retained to avoid corrupting proper names; acronyms and column letters stay intact.
const common=new Set(('a o as os de da do das dos e em no na nos nas com sem para por '+
 'motorista passageiro dianteiro dianteira dianteiros dianteiras traseiro traseira traseiros traseiras '+
 'direito direita direitos direitas esquerdo esquerda esquerdos esquerdas interno interna internos internas externo externa externos externas '+
 'central lateral laterais superior inferior frente traseira teto topo completo completa veículo veículos '+
 'para lama choque brisa barro capô porta portas carga coluna painel travessa radiador cofre motor vidro vidros '+
 'farol faróis milha alojamento alojamentos moldura molduras iluminação lanterna lanternas roda rodas pinça freio caixa caixas '+
 'alma acabamento acabamentos plástico plásticos adesivo adesivos aerofólio portinhola abastecimento grade grades entrada entradas ar '+
 'retrovisor retrovisores suporte estrutura ponteira rack maçaneta friso borracha borrachas revestimento '+
 'amassado amassada quebrado quebrada contaminado contaminada comprometido comprometida ressecado ressecada '+
 'pintura perda brilho ressecamento desalinhamento risco riscos arranhado arranhada cuidados operacionais '+
 'leve moderado moderada severo severa preparação técnica técnicas técnico técnicos '+
 'desmontagem montagem colorimetria funilaria alinhamento correção estrutural estética revitalização serviços complementares '+
 'degradê pequenos reparos ajuste fino lavagem elétrica vidraçaria tapeçaria mecânica polimento limpeza couro hidratação '+
 'descontaminação corte refino lustre aplicação vinil remoção reparo solda plástica diagnostico diagnóstico mascaramento proteção ducha área').split(/\s+/))
export function pdfExpression(value:string):string{
 const text=value.normalize('NFC').replace(/·/g,' ').replace(/\s+/gu,' ').trim()
 const normalized=text.replace(/[\p{L}\p{M}\p{N}]+/gu,word=>{
  if(word==='A')return word // e.g. Coluna A; do not turn an identity into an article.
  const lower=word.toLocaleLowerCase('pt-BR')
  return common.has(lower)?lower:word
 })
 const first=normalized.match(/^[\p{L}\p{M}\p{N}]+/u)?.[0]
 if(first&&!common.has(first.toLocaleLowerCase('pt-BR'))&&/\p{Ll}.*\p{Lu}/u.test(first))return normalized
 return normalized.replace(/^\p{Ll}/u,letter=>letter.toLocaleUpperCase('pt-BR'))
}
export function pdfDiagnosis(diagnosis:string,intensity:DiagnosisIntensity|null|undefined):string{
 return pdfExpression([diagnosis,intensity].filter(Boolean).join(' '))
}
export function pdfStage(value:string):string{
 // Recognize only the old generated technical suffix. Keep legitimate (PDR),
 // brand names and other parentheses; never strip arbitrary words from a name.
 return pdfExpression(value.replace(/\s*\([^()]*\b(?:dimens[aã]o\b|qtd\.\s*:)[^()]*\)\s*$/iu,''))
}
