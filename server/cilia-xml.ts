import {createHash} from 'node:crypto'
import {ServiceError} from './errors.ts'
import {Q,sum} from './exact.ts'

// Initial Cilia data-only XML profile. No general-purpose XML, DTD, attributes,
// comments, processing instructions, CDATA, external entities or network access.
// The reader fails closed on unsupported syntax and is deliberately not wired to
// HTTP, storage, native pricing, identity matching or commercial approval.
const bad=():never=>{throw new ServiceError(422,'CILIA_XML_INVALID','XML Cilia inválido ou formato não suportado.')}
type Element={tag:string;text:string;children:Element[]}
const MAX_BYTES=512*1024
function entities(raw:string){
  if(raw.includes(']]>'))return bad()
  return raw.replace(/&([^;&]*);|&/g,(_,entity:string|undefined)=>{
    const predefined:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}
    if(entity&&Object.hasOwn(predefined,entity))return predefined[entity]!
    if(!entity||!/^#(?:[0-9]{1,7}|x[0-9a-fA-F]{1,6})$/.test(entity))return bad()
    const cp=entity.startsWith('#x')?Number.parseInt(entity.slice(2),16):Number.parseInt(entity.slice(1),10)
    if(!(cp===9||cp===10||cp===13||(cp>=32&&cp<=0xd7ff)||(cp>=0xe000&&cp<=0xfffd)||(cp>=0x10000&&cp<=0x10ffff)))return bad()
    return String.fromCodePoint(cp)
  })
}
function readXml(bytes:Uint8Array):Element{
  if(!bytes.length||bytes.length>MAX_BYTES)return bad()
  let input:string
  try{input=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{return bad()}
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(input))return bad()
  input=input.replace(/\r\n?/g,'\n')
  if(input.startsWith('<?xml')){
    const declaration=/^<\?xml\s+version\s*=\s*(?:"1\.0"|'1\.0')(?:\s+encoding\s*=\s*(?:"UTF-8"|'UTF-8'))?\s*\?>/i.exec(input)
    if(!declaration)return bad()
    input=input.slice(declaration[0].length)
  }
  const stack:Element[]=[]
  let root:Element|undefined,offset=0,count=0
  while(offset<input.length){
    if(input[offset]==='<'){
      const end=input.indexOf('>',offset+1)
      if(end<0||end-offset>128)return bad()
      const token=input.slice(offset,end+1)
      const close=/^<\/([a-z_][a-z0-9_]*)\s*>$/.exec(token)
      if(close){
        const top=stack.pop()
        if(!top||top.tag!==close[1]||(top.children.length>0&&top.text.trim()))return bad()
      }else{
        const open=/^<([a-z_][a-z0-9_]*)\s*(\/?)>$/.exec(token)
        if(!open||++count>20000||stack.length>=24)return bad()
        const el:Element={tag:open[1]!,text:'',children:[]}
        const parent=stack.at(-1)
        if(parent)parent.children.push(el)
        else if(root)return bad()
        else root=el
        if(!open[2])stack.push(el)
      }
      offset=end+1
    }else{
      const next=input.indexOf('<',offset)
      const end=next<0?input.length:next
      const raw=input.slice(offset,end)
      const parent=stack.at(-1)
      if(parent){
        parent.text+=entities(raw)
        if(parent.text.length>32768)return bad()
      }else if(raw.trim())return bad()
      offset=end
    }
  }
  if(stack.length||root?.tag!=='orcamento')return bad()
  return root
}
function one(parent:Element,tag:string,optional=false):Element|undefined{
  const matches=parent.children.filter(x=>x.tag===tag)
  if(matches.length>1||(!optional&&!matches.length))return bad()
  return matches[0]
}
function leaf(parent:Element,tag:string,optional=false):string|null{
  const x=one(parent,tag,optional)
  if(!x)return null
  if(x.children.length)return bad()
  return x.text.trim()||null
}
function required(parent:Element,tag:string):string{
  return leaf(parent,tag)??bad()
}
function decimal(parent:Element,tag:string,optional=false){
  const value=leaf(parent,tag,optional)
  if(value===null){if(optional)return null;return bad()}
  if(!/^\d{1,12}(?:\.\d{1,6})?$/.test(value))return bad()
  return Q.from(value).toString()
}
const dec=(parent:Element,tag:string)=>decimal(parent,tag)??bad()
function flag(parent:Element,tag:string){
  const value=required(parent,tag)
  if(value!=='true'&&value!=='false')return bad()
  return value==='true'
}
function uniqueFields(el:Element,allowed:readonly string[],issues:string[],label:string){
  const seen=new Set<string>()
  for(const f of el.children){
    if(seen.has(f.tag))return bad()
    seen.add(f.tag)
    if(!allowed.includes(f.tag)&&!issues.includes('UNSUPPORTED_FIELD:'+label))issues.push('UNSUPPORTED_FIELD:'+label)
  }
}
const norm=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim()
const cents=(q:Q)=>q.mul(new Q(100n)).d===1n
const sections=['totais_em_impacto','totais_sem_cobertura','totais_sob_analise'] as const
const groups=['troca_e_remocao_instalacao','pintura','reparacao','funilaria','vidracaria','tapecaria','eletrica','mecanica'] as const
const amounts=['valor_servico_manual','valor_fornecimento_oficina','valor_fornecimento_seguradora','valor_total'] as const
const totalFields=['valor_bruto_pecas','valor_desconto','valor_desconto_pecas_manuais','valor_liquido_mao_de_obra','valor_total_geral','valor_pecas_pela_oficina','valor_franquia','valor_deducao','valor_total_liquido_geral'] as const
const rateFields=['valor_hora_mao_de_obra','valor_hora_reparacao','valor_hora_pintura_tricoat','valor_hora_pintura','majoracao','desconto'] as const
const itemFields=['tipo_item','tipo','codigo','nome','comentario','troca','remocao_instalacao','pintura','reparacao','inclusao_manual','preco','preco_liquido','percentual_desconto','quantidade','tipo_remocao_instalacao','hora_remocao_instalacao','hora_reparacao','hora_pintura','fornecimento'] as const

export function readCiliaBudgetXml(bytes:Uint8Array){
  const root=readXml(bytes),issues:string[]=[]
  uniqueFields(root,['dados_da_oficina','nome_da_versao','status','numero_orcamento','versao_orcamento','numero_sinistro','data_criacao_orcamento','data_alteracao_status_orcamento','atendimento_web','tipo_do_processo','seguradora','cliente','veiculo','itens_orcamento','padrao_mao_de_obra','conclusao','albums','notas_oficina','notas_fornecedor','resumo_geral','total_do_orcamento'],issues,'ROOT')
  const insurer=one(root,'seguradora')!,vehicle=one(root,'veiculo')!,ratesNode=one(root,'padrao_mao_de_obra')!,totalNode=one(root,'total_do_orcamento')!
  uniqueFields(ratesNode,rateFields,issues,'RATES')
  uniqueFields(totalNode,totalFields,issues,'TOTAL')
  // Source identity is evidence only; it never authorizes a native match.
  const identity={
    issuerName:required(insurer,'nome'),issuerTaxId:required(insurer,'cnpj'),
    number:required(root,'numero_orcamento'),revision:required(root,'versao_orcamento'),
    event:leaf(root,'numero_sinistro'),versionName:leaf(root,'nome_da_versao'),
    createdAt:leaf(root,'data_criacao_orcamento'),status:required(root,'status'),
    statusAt:leaf(root,'data_alteracao_status_orcamento'),processType:leaf(root,'tipo_do_processo'),
    plate:leaf(vehicle,'placa'),vin:leaf(vehicle,'chassi'),vehicleName:leaf(vehicle,'nome_veiculo'),
    color:leaf(vehicle,'cor'),paintType:leaf(vehicle,'tipo_pintura')
  }
  if(!identity.plate||!identity.vin||!identity.event)issues.push('IDENTITY_REVIEW')
  const rates=Object.fromEntries(rateFields.map(k=>[k,dec(ratesNode,k)])) as Record<typeof rateFields[number],string>
  const totals=Object.fromEntries(totalFields.map(k=>[k,dec(totalNode,k)])) as Record<typeof totalFields[number],string>
  const paint=norm(identity.paintType??'')
  const paintRate=paint==='tricoat'||paint==='tricot' ? rates.valor_hora_pintura_tricoat
    : ['comum','solida','metalica','perolizada'].includes(paint)?rates.valor_hora_pintura:null
  if(!paintRate)issues.push('PAINT_RATE_REVIEW')
  if(Q.from(rates.majoracao).n||Q.from(rates.desconto).n)issues.push('LABOR_ADJUSTMENT_REVIEW')
  if(Q.from(totals.valor_franquia).n||Q.from(totals.valor_deducao).n)issues.push('PARTICIPATION_REVIEW')
  if(Q.from(totals.valor_desconto).n||Q.from(totals.valor_desconto_pecas_manuais).n)issues.push('SOURCE_DISCOUNT_REVIEW')
  const itemsNode=one(root,'itens_orcamento')!
  if(!itemsNode.children.length||itemsNode.children.length>1000||itemsNode.children.some(x=>x.tag!=='item'))return bad()
  const items=itemsNode.children.map((item,index)=>{
    const id='row-'+(index+1)
    const review=(code:string)=>issues.push(code+':'+id)
    uniqueFields(item,itemFields,issues,id)
    const name=required(item,'nome'),code=leaf(item,'codigo')
    const type=required(item,'tipo_item'),scope=required(item,'tipo'),supply=required(item,'fornecimento')
    const rawFlags={troca:flag(item,'troca'),remocaoInstalacao:flag(item,'remocao_instalacao'),pintura:flag(item,'pintura'),reparacao:flag(item,'reparacao'),manual:flag(item,'inclusao_manual')}
    const hours={removal:decimal(item,'hora_remocao_instalacao',true),repair:decimal(item,'hora_reparacao',true),paint:decimal(item,'hora_pintura',true)}
    const removalKind=leaf(item,'tipo_remocao_instalacao')
    const quantity=dec(item,'quantidade'),grossPrice=dec(item,'preco'),netPrice=dec(item,'preco_liquido'),discountPercent=dec(item,'percentual_desconto')
    if(!Q.from(quantity).n)return bad()
    if(quantity!=='1')review('QUANTITY_SEMANTICS_REVIEW')
    if(Q.from(discountPercent).n||Q.from(netPrice).cmp(Q.from(grossPrice))!==0)review('ITEM_DISCOUNT_REVIEW')
    if(norm(scope)!=='impacto')review('SCOPE_REVIEW')
    const supplyKind=norm(supply)==='associacao'?'partner':norm(supply)==='oficina'?'workshop':'unknown'
    if(supplyKind==='unknown')review('SUPPLY_REVIEW')
    const typeKind=norm(type)==='peca'?'part':norm(type)==='servico'?'service':'unknown'
    if(typeKind==='unknown')review('ITEM_TYPE_REVIEW')
    const ops:{kind:'T'|'RI'|'R'|'P';hours:string|null;rate:string|null;amount:string|null}[]=[]
    const operation=(enabled:boolean,kind:'T'|'RI'|'R'|'P',time:string|null,rate:string|null)=>{
      if(!enabled){if(time!==null&&Q.from(time).n)review('HOURS_WITHOUT_OPERATION');return}
      if(time===null||rate===null){review('OPERATION_AMOUNT_UNKNOWN');ops.push({kind,hours:time,rate,amount:null});return}
      const value=Q.from(time).mul(Q.from(rate))
      if(!cents(value))review('OPERATION_ROUNDING_REVIEW')
      ops.push({kind,hours:time,rate,amount:value.toString()})
    }
    // A Cilia replacement has both flags in the observed export, but one time.
    operation(rawFlags.troca||rawFlags.remocaoInstalacao,rawFlags.troca?'T':'RI',hours.removal,rates.valor_hora_mao_de_obra)
    operation(rawFlags.reparacao,'R',hours.repair,rates.valor_hora_reparacao)
    operation(rawFlags.pintura,'P',hours.paint,paintRate)
    if(typeKind==='service'&&ops.length)review('MANUAL_SERVICE_OPERATION_REVIEW')
    if(typeKind==='service'&&supplyKind!=='workshop')review('MANUAL_SERVICE_SUPPLY_REVIEW')
    if(typeKind==='part'&&!rawFlags.troca&&Q.from(netPrice).n)review('PART_PRICE_WITHOUT_REPLACEMENT')
    if(!ops.length&&typeKind==='part')review('PART_WITHOUT_OPERATION')
    return {id,name,code,type,scope,supply,supplyKind,typeKind,comment:leaf(item,'comentario',true),rawFlags,hours,removalKind,quantity,grossPrice,netPrice,discountPercent,operations:ops}
  })
  // Preserve every reported summary, including excluded coverage. Compare
  // the observed supported accounting profile; others remain review-only.
  const summaryNode=one(root,'resumo_geral')!
  uniqueFields(summaryNode,sections,issues,'SUMMARY')
  const summary=Object.fromEntries(sections.map(section=>{
    const s=one(summaryNode,section)!
    uniqueFields(s,[...groups,...amounts],issues,section)
    const g=Object.fromEntries(groups.map(k=>{
      const v=one(s,k)!
      uniqueFields(v,['valor','tempo'],issues,k)
      return [k,{amount:dec(v,'valor'),hours:dec(v,'tempo')}]
    })) as Record<typeof groups[number],{amount:string;hours:string}>
    const a=Object.fromEntries(amounts.map(k=>[k,dec(s,k)])) as Record<typeof amounts[number],string>
    return [section,{groups:g,amounts:a}]
  })) as Record<typeof sections[number],{groups:Record<typeof groups[number],{amount:string;hours:string}>;amounts:Record<typeof amounts[number],string>}>
  for(const s of ['totais_sem_cobertura','totais_sob_analise'] as const){
    if(Object.values(summary[s].amounts).some(v=>Q.from(v).n)||Object.values(summary[s].groups).some(v=>Q.from(v.amount).n||Q.from(v.hours).n))issues.push('EXCLUDED_SCOPE_REVIEW:'+s)
  }
  const covered=items.filter(i=>norm(i.scope)==='impacto')
  const comparison=(actual:Q,reported:string,label:string)=>{if(actual.cmp(Q.from(reported))!==0)issues.push('TOTAL_MISMATCH:'+label)}
  const impact=summary.totais_em_impacto
  const ops=covered.flatMap(i=>i.operations)
  const money=(subset:typeof ops)=>sum(subset.map(o=>Q.from(o.amount??'0')))
  // Amounts are line references, not native quantities. For non-unit
  // quantities the source semantics are not established and are flagged.
  if(covered.every(i=>i.quantity==='1')&&ops.every(o=>o.amount!==null&&o.hours!==null&&cents(Q.from(o.amount)))){
    for(const [g,kinds] of [['troca_e_remocao_instalacao',['T','RI']],['reparacao',['R']],['pintura',['P']]] as const){
      const subset=ops.filter(o=>(kinds as readonly string[]).includes(o.kind))
      comparison(money(subset),impact.groups[g].amount,g)
      comparison(sum(subset.map(o=>Q.from(o.hours!))),impact.groups[g].hours,g+':hours')
    }
    const manual=sum(covered.filter(i=>i.typeKind==='service').map(i=>Q.from(i.netPrice)))
    const parts=(supply:string)=>sum(covered.filter(i=>i.typeKind==='part'&&i.rawFlags.troca&&i.supplyKind===supply).map(i=>Q.from(i.netPrice)))
    const workshop=parts('workshop'),partner=parts('partner'),labor=money(ops).add(manual),office=labor.add(workshop),global=office.add(partner)
    comparison(manual,impact.amounts.valor_servico_manual,'manual')
    comparison(workshop,impact.amounts.valor_fornecimento_oficina,'workshop_parts')
    comparison(partner,impact.amounts.valor_fornecimento_seguradora,'partner_parts')
    comparison(global,impact.amounts.valor_total,'impact')
    comparison(labor,totals.valor_liquido_mao_de_obra,'labor')
    comparison(workshop,totals.valor_pecas_pela_oficina,'workshop_total')
    comparison(global,totals.valor_total_geral,'global')
    if(!Q.from(totals.valor_franquia).n&&!Q.from(totals.valor_deducao).n)comparison(office,totals.valor_total_liquido_geral,'net_office')
    return {kind:'cilia-xml-v1' as const,identity,rates,items,summary,totals,evidenceSha256:createHash('sha256').update(bytes).digest('hex'),calculated:{labor:labor.toString(),workshopParts:workshop.toString(),partnerParts:partner.toString(),workshopTotal:office.toString(),global:global.toString()},issues,financialIntegrity:issues.length===0,canWrite:false as const}
  }
  issues.push('FINANCIAL_COMPARISON_UNAVAILABLE')
  return {kind:'cilia-xml-v1' as const,identity,rates,items,summary,totals,evidenceSha256:createHash('sha256').update(bytes).digest('hex'),calculated:null,issues,financialIntegrity:false,canWrite:false as const}
}
