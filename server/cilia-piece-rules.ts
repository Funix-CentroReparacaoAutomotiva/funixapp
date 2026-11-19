// Candidate seed from the approved research scope (matrix v0.3), NOT an
// approved technical mapping or automatic merge. Only generic part names
// and public catalog codes are included; no customer or quote data.
export const CILIA_PIECE_RULE_VERSION='cilia-piece-candidates-v1'
type RuleClass='D'|'G'|'R'
type Steering='left'|'right'|'unknown'
type PieceCatalogEntry={id:string;kind:string;code:string|null;name:string;active:boolean}

const rawRules=`CAPÔ|D|capo
ANTI-RUÍDO DO CAPÔ|G|capo
DOBRADIÇA DIR DO CAPÔ|G|capo
DOBRADIÇA ESQ DO CAPÔ|G|capo
PARALAMA DIANT DIR|D|para_lama_dianteiro__passageiro
PARABARRO DIANT DIR|D|para_barro_dianteiro__passageiro
PARACHOQUE DIANT SUPERIOR|D|para_choque_dianteiro
FAROL DIREITO|D|farol__passageiro
PARALAMA DIANT ESQ|D|para_lama_dianteiro__motorista
PARABARRO DIANT ESQ|D|para_barro_dianteiro__motorista
MOLDURA DO VÃO DE RODA DIANT DIR|G|para_lama_dianteiro__passageiro
MOLDURA DO VÃO DE RODA DIANT ESQ|G|para_lama_dianteiro__motorista
FAROL ESQUERDO|D|farol__motorista
PARACHOQUE DIANT INFERIOR|R|para_choque_dianteiro,spoiler_dianteiro
GRADE DO RADIADOR|D|grade_dianteira
PARACHOQUE DIANT INTERNO|R|alma_para_choque_dianteiro,painel_dianteiro
MOLDURA DO FAROL DE MILHA DIR|D|moldura_farol_milha__passageiro
MOLDURA DO FAROL DE MILHA ESQ|D|moldura_farol_milha__motorista
SUPORTE DIR DO PARACHOQUE DIANT SUPERIOR|G|para_choque_dianteiro
SUPORTE ESQ DO PARACHOQUE DIANT SUPERIOR|G|para_choque_dianteiro
RADIADOR|R|
LONGARINA DIANTEIRA ESQ|D|longarina_dianteira__motorista
LONGARINA DIANTEIRA DIR|D|longarina_dianteira__passageiro
FECHAMENTO DA LONGARINA DIANT DIR|G|longarina_dianteira__passageiro
FECHAMENTO DA LONGARINA DIANT ESQ|G|longarina_dianteira__motorista
TRAVESSA SUP DO PAINEL DIANT|R|painel_dianteiro,travessa_do_radiador
TRAVESSA DE APOIO DO RADIADOR|D|travessa_do_radiador
SUPORTE ESQ DO PAINEL DIANTEIRO|G|painel_dianteiro
SUPORTE DIR DO PAINEL DIANTEIRO|G|painel_dianteiro
REM E INST CONJUNTO MOTRIZ|R|veiculo_completo
CAIXA DE RODA DIANT ESQ|D|caixa_roda_dianteira__motorista
PORTA DIANTEIRA DIR|D|porta_dianteira__passageiro
PARACHOQUE TRASEIRO|D|para_choque_traseiro
FRISO CROMADO DO PARACHOQUE TRASEIRO IINFERIOR|G|para_choque_traseiro
GUIA DIR DO PARACHOQUE TRAS|G|para_choque_traseiro
GUIA ESQ DO PARACHOQUE TRAS|G|para_choque_traseiro
SPOILER DO PARACHOQUE TRAS|D|spoiler_traseiro
REBOQUE TRASEIRO UNIÃO|R|
PORTA DIANTEIRA ESQ|D|porta_dianteira__motorista
MOLDURA DA PORTA DIANT ESQ|D|moldura_porta_dianteira__motorista
EMBLEMA DA PORTA DIANT ESQ|G|porta_dianteira__motorista
ABERTURA DE TINTA NA PORTA TRASEIRA ESQUERDA|D|porta_traseira__motorista
ABERTURA DE TINTA NO PARA-LAMA DIANTEIRO ESQUERDO|D|para_lama_dianteiro__motorista
LIMPEZA DOS CÓDIGOS DE FALHA|R|veiculo_completo
PREPARAÇÃO CAPO FORNECIDO|R|capo
PREPARAÇÃO PARACHOQUE DIANTEIRO FORNECIDO|R|para_choque_dianteiro
PREPARAÇÃO PARALAMA DIR|R|para_lama_dianteiro__passageiro
AJUSTE TINTA TRICOAT|R|
EMBLEMA DO CAPÔ|G|capo
MOLDURA DA GRADE DO RADIADOR|G|grade_dianteira
TAMPÃO DO PARACHOQUE DIANT INFERIOR|G|para_choque_dianteiro
CONDENSADOR DO A/C|R|
GUIA DIR DO PARACHOQUE DIANT SUPERIOR|G|para_choque_dianteiro
GUIA ESQ DO PARACHOQUE DIANT SUPERIOR|G|para_choque_dianteiro
ESPELHO RETROVISOR ESQ|D|retrovisor__motorista
FORRO DA PORTA DIANTEIRA ESQ|G|interno_porta_dianteira__motorista
FORRO DA PORTA TRASEIRA ESQ|G|interno_porta_traseira__motorista
VIDRO DA PORTA DIANT ESQ|D|vidro_porta_dianteira__motorista
VIDRO DA PORTA TRAS ESQ|D|vidro_porta_traseira__motorista
VIDRO FIXO DA PORTA TRAS ESQ|G|vidro_porta_traseira__motorista
LATERAL EXTERNA ESQ - CORTE PARCIAL COLUNA C|R|lateral_traseira__motorista
ASSOALHO TRASEIRO|R|assoalho_porta_malas
PAINEL TRASEIRO|D|painel_traseiro
TAMPA TRASEIRA|D|tampa_porta_malas
LATERAL EXTERNA DIR - CORTE PARCIAL COLUNA C|R|lateral_traseira__passageiro
MICROPINTURA PORTA TRASEIRA DIREITA|D|porta_traseira__passageiro
LANTERNA TRASEIRA DIR|D|lanterna_traseira__passageiro
PARABARRO TRAS DIR|D|para_barro_traseiro__passageiro
REM/INST COMPONENTES DA TAMPA TRASEIRA|G|tampa_porta_malas
FRISO DA PORTA DIANT ESQ|D|friso_porta_dianteira__motorista
FRISO DA PORTA TRAS ESQ|D|friso_porta_traseira__motorista
PORTA TRASEIRA ESQ|D|porta_traseira__motorista
PARACHOQUE TRAS DIR PRIMER|R|para_choque_traseiro
PARACHOQUE TRAS ESQ PRIMER|R|para_choque_traseiro
PORTA DIREITA|R|porta_dianteira__passageiro
CHAPA DA COLUNA DIANTEIRA DIR|R|coluna_a__passageiro
PAINEL DIANTEIRO|D|painel_dianteiro
BIGODE DO PARACHOQUE DIANT|R|para_choque_dianteiro
PINTURA E POLIMENTO NA RODA DIANT DIR|R|roda_dianteira__passageiro
BORRACHARIA NA RODA DIANT DIR ]|R|roda_dianteira__passageiro`

// Exact token normalization only. No fuzzy matching, substring matching,
// stripping of qualifiers, or inference from the external OEM code.
export function normalizeCiliaPieceTitle(value:string){
 return value.normalize('NFD').replace(/\p{M}/gu,'').toUpperCase()
  .replace(/[‐‑–—-]/g,' ').replace(/\s+/gu,' ').trim()
  .replace(/\bPARA (CHOQUE|LAMA|BARRO)\b/g,'PARA$1')
  .replace(/\b(DIR|DIREITA)\b/g,'DIREITO').replace(/\b(ESQ|ESQUERDA)\b/g,'ESQUERDO')
  .replace(/\b(DIANT|DIANTEIRA)\b/g,'DIANTEIRO').replace(/\b(TRAS|TRASEIRA)\b/g,'TRASEIRO')
  .replace(/\bSUP\b/g,'SUPERIOR')
}
const rules=new Map<string,{id:string;classification:RuleClass;codes:readonly string[]}>()
for(const [index,line] of rawRules.split('\n').entries()){
 const [title,classification,codeList]=line.split('|')
 if(!title||(classification!=='D'&&classification!=='G'&&classification!=='R')||codeList===undefined)throw new Error('CILIA_RULE_INVALID')
 const key=normalizeCiliaPieceTitle(title),codes=codeList?codeList.split(','):[]
 if(rules.has(key)||codes.some(c=>! /^[a-z0-9_]+$/.test(c))||new Set(codes).size!==codes.length||(classification!=='R'&&codes.length!==1))throw new Error('CILIA_RULE_CONFLICT')
 rules.set(key,{id:'piece-'+(index+1),classification,codes})
}
export const CILIA_PIECE_RULE_COUNT=rules.size

/** Read-only identity suggestion; the caller must retain the source row,
 * operations and components separately. Never changes catalog or native data. */
export function suggestCiliaPiece(title:string,catalog:readonly PieceCatalogEntry[],steering:Steering='unknown'){
 const rule=rules.get(normalizeCiliaPieceTitle(title))
 const issues:string[]=[],candidates:{code:string;pieceId:string}[]=[]
 if(!rule)return {version:CILIA_PIECE_RULE_VERSION,ruleId:null,classification:null,state:'unmapped' as const,candidates,issues:['UNKNOWN_TITLE'],requiresOperatorReview:true as const,canWrite:false as const}
 if(rule.classification==='G')issues.push('GROUP_SCOPE_REVIEW')
 if(rule.classification==='R')issues.push('IDENTITY_REVIEW')
 for(const code of rule.codes){
  if(/__(motorista|passageiro)$/.test(code)&&steering!=='left'){issues.push('STEERING_REVIEW');continue}
  const matches=catalog.filter(c=>c.kind==='peca'&&c.code===code)
  if(matches.length!==1){issues.push((matches.length?'CATALOG_CODE_AMBIGUOUS:':'CATALOG_CODE_MISSING:')+code);continue}
  const item=matches[0]!
  if(!item.active||!item.name.trim()||!item.id.trim()){issues.push('CATALOG_CODE_UNUSABLE:'+code);continue}
  candidates.push({code,pieceId:item.id})
 }
 return {version:CILIA_PIECE_RULE_VERSION,ruleId:rule.id,classification:rule.classification,state:issues.length||candidates.length!==1?'review' as const:'candidate' as const,candidates,issues:[...new Set(issues)],requiresOperatorReview:true as const,canWrite:false as const}
}
