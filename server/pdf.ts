import {readFileSync} from 'node:fs'
import {deflateSync} from 'node:zlib'
import type {BudgetVersion} from '../shared/pricing.ts'
import {money} from '../shared/format.ts'

// Bundled, licensed font; no host fonts, network, browser, paid service or renderer dependency.
const font=readFileSync(new URL('./data/fonts/DejaVuSans.ttf',import.meta.url))
const tables=new Map<string,number>()
for(let i=0;i<font.readUInt16BE(4);i++){const p=12+i*16;tables.set(font.toString('ascii',p,p+4),font.readUInt32BE(p+8))}
const head=tables.get('head')!,hhea=tables.get('hhea')!,hmtx=tables.get('hmtx')!,cmap=tables.get('cmap')!
const units=font.readUInt16BE(head+18),metrics=font.readUInt16BE(hhea+34)
let cmap12=0,cmap4=0
for(let i=0;i<font.readUInt16BE(cmap+2);i++){const p=cmap+4+i*8,offset=cmap+font.readUInt32BE(p+4),format=font.readUInt16BE(offset);if(format===12)cmap12=offset;if(format===4)cmap4=offset}
function glyph(code:number):number {
 if(cmap12){let low=0,high=font.readUInt32BE(cmap12+12)-1;while(low<=high){const mid=(low+high)>>1,p=cmap12+16+mid*12,start=font.readUInt32BE(p),end=font.readUInt32BE(p+4);if(code<start)high=mid-1;else if(code>end)low=mid+1;else return font.readUInt32BE(p+8)+code-start}return 0}
 if(cmap4&&code<=65535){const count=font.readUInt16BE(cmap4+6)/2,end=cmap4+14,start=end+count*2+2,delta=start+count*2,range=delta+count*2;for(let i=0;i<count;i++){const a=font.readUInt16BE(start+i*2),b=font.readUInt16BE(end+i*2);if(code<a||code>b)continue;const d=font.readInt16BE(delta+i*2),r=font.readUInt16BE(range+i*2);if(!r)return(code+d)&65535;const g=font.readUInt16BE(range+i*2+r+(code-a)*2);return g?(g+d)&65535:0}}
 return 0
}
function width(char:string){return Math.round(font.readUInt16BE(hmtx+Math.min(glyph(char.codePointAt(0)!),metrics-1)*4)*1000/units)}
function wrap(text:string):string[]{
 const result:string[]=[]
 for(const paragraph of text.replace(/\r/g,'').split('\n')){
  let line='',size=0
  for(const char of paragraph){const w=width(char)*10/1000;if(size+w>495&&line){result.push(line);line='';size=0}line+=char;size+=w}
  result.push(line)
 }
 return result
}
const utf16=(value:string)=>{const b=Buffer.from(value,'utf16le');b.swap16();return b.toString('hex').toUpperCase()}

export function budgetPdf(version:BudgetVersion):Buffer {
 const {snapshot:s}=version,c=s.calculation
 if(c.errors.length||c.total===null||c.days===null)throw new Error('Não gerar PDF de emissão incompleta.')
 const paragraphs=[`FUNIX | Orçamento ${version.label}`,`Versão ${version.sequence} | ${version.createdAt} | Cenário: ${s.scenarioName}`,
  `Atendimento: ${s.atendimento.id}`,`Contato: ${s.atendimento.name||'Não informado'} | Telefone: ${s.atendimento.phone}`,
  `Veículo: ${s.atendimento.vehicle||[s.atendimento.brand,s.atendimento.model].filter(Boolean).join(' ')||'Não informado'} | Placa: ${s.atendimento.plate||'Não informada'}`,
  'Escopo comercial da versão emitida:']
 for(const line of c.lines.filter(l=>l.included)){
  paragraphs.push(`${line.pieceName} | ${line.kind==='service'?'Serviço':'Componente'}: ${line.name}`,
   `Dimensão: ${line.dimension||'Não aplicável'} | Diagnóstico: ${line.diagnosis||'Não informado'}`,
   line.billing==='not_billed'?`${line.quantity} · Sem cobrança`:`${line.quantity} x ${money(line.finalUnit)} = ${money(line.total)}`)
  if(line.finalUnit!==line.unit)paragraphs.push(`Unitário de referência: ${money(line.unit)} | Unitário efetivo: ${money(line.finalUnit)}`)
  if(line.notes)paragraphs.push(`Observação: ${line.notes}`)
  if(line.kind==='component')paragraphs.push(`Preço manual: ${money(line.factors.manualPrice)} | MR do Atendimento: ${line.factors.MRPercent!==undefined?line.factors.MRPercent+'%':line.factors.MR}`)
  for(const stage of line.stages)paragraphs.push(`Etapa: ${stage.name} | Dimensão técnica: ${stage.dimension} | Energia base ${stage.baseEnergy} + dimensional ${stage.dimensionEnergy}`)
 }
 paragraphs.push(`Serviços originais: ${money(c.originalServiceSubtotal)}`,`Serviços efetivos: ${money(c.serviceSubtotal)}`,`Desconto em serviços: ${money(c.discount)}`,`Componentes: ${money(c.componentSubtotal)}`,`TOTAL EFETIVO: ${money(c.total)}`)
 if(c.target!==null)paragraphs.push(`Subtotal de serviços informado: ${money(c.target)} | Diferença residual: ${money(c.residual)} | Ciência: ${c.negotiation.mode!=='none'&&c.negotiation.acknowledgeResidual?'Sim':'Não aplicável'}`)
 paragraphs.push(`Energia total: ${c.energy} | Estimativa: ${c.days} dia(s) técnico(s).`,
  'Dias técnicos representam o escopo; não são data de entrega nem autorização de execução.',
  `Condições e ressalvas comerciais: ${s.conditions||'Não informadas.'}`,
  'Documento comercial. Não é ordem de serviço. Atendimento operacional permanece no ERP.',
  `Identificador imutável da versão: ${version.id}`)
 const lines=paragraphs.flatMap(wrap),pages:string[][]=[]
 for(let i=0;i<lines.length;i+=46)pages.push(lines.slice(i,i+46))
 const footers=pages.map((_,i)=>`FUNIX | Página ${i+1}/${pages.length} | Orçamento ${version.label}`)
 const chars=[...new Set([...lines.join(''),...footers.join('')])].sort((a,b)=>a.codePointAt(0)!-b.codePointAt(0)!)
 if(chars.length>65534)throw new Error('Documento excede caracteres suportados.')
 const cid=new Map(chars.map((char,i)=>[char,i+1])),code=(text:string)=>[...text].map(ch=>(cid.get(ch)??0).toString(16).padStart(4,'0')).join('')
 const objects:Buffer[]=[]
 const add=(data:string|Buffer)=>{objects.push(typeof data==='string'?Buffer.from(data,'ascii'):data);return objects.length}
 const stream=(data:Buffer,extra='')=>{const compressed=deflateSync(data);return Buffer.concat([Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode ${extra} >>\nstream\n`),compressed,Buffer.from('\nendstream')])}
 add('');add('')
 const fontFile=add(stream(font,`/Length1 ${font.length}`))
 const scale=(value:number)=>Math.round(value*1000/units)
 const bbox=[36,38,40,42].map(o=>scale(font.readInt16BE(head+o))).join(' ')
 const descriptor=add(`<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 32 /FontBBox [${bbox}] /ItalicAngle 0 /Ascent ${scale(font.readInt16BE(hhea+4))} /Descent ${scale(font.readInt16BE(hhea+6))} /CapHeight 750 /StemV 80 /FontFile2 ${fontFile} 0 R >>`)
 const map=Buffer.alloc((chars.length+1)*2);chars.forEach((char,i)=>map.writeUInt16BE(glyph(char.codePointAt(0)!),(i+1)*2))
 const gid=add(stream(map))
 const cidFont=add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap ${gid} 0 R /DW 1000 /W [${chars.map((char,i)=>`${i+1} [${width(char)}]`).join(' ')}] >>`)
 let mapping='/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /FUNIXUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'
 for(let i=0;i<chars.length;i+=100){const chunk=chars.slice(i,i+100);mapping+=`${chunk.length} beginbfchar\n`+chunk.map((ch,j)=>`<${(i+j+1).toString(16).padStart(4,'0')}> <${utf16(ch)}>`).join('\n')+'\nendbfchar\n'}
 mapping+='endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend'
 const unicode=add(stream(Buffer.from(mapping,'ascii'))),type0=add(`<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${unicode} 0 R >>`)
 const pageIds:number[]=[]
 pages.forEach((page,index)=>{
  const content=page.map((line,i)=>`BT /F1 ${i===0&&index===0?15:10} Tf 0.05 0.14 0.30 rg 45 ${795-i*15} Td <${code(line)}> Tj ET`).join('\n')+`\nBT /F1 8 Tf 45 55 Td <${code(footers[index]!)}> Tj ET`
  const contents=add(stream(Buffer.from(content,'ascii')))
  pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${type0} 0 R >> >> /Contents ${contents} 0 R >>`))
 })
 objects[0]=Buffer.from('<< /Type /Catalog /Pages 2 0 R /Lang (pt-BR) >>')
 objects[1]=Buffer.from(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`)
 const info=add(`<< /Title <FEFF${utf16('FUNIX Orçamento '+version.label)}> /Producer (FUNIX) >>`)
 const buffers=[Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n','latin1')],offsets=[0];let length=buffers[0]!.length
 objects.forEach((obj,i)=>{offsets.push(length);const b=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),obj,Buffer.from('\nendobj\n')]);buffers.push(b);length+=b.length})
 buffers.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${n.toString().padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${length}\n%%EOF\n`))
 return Buffer.concat(buffers)
}
