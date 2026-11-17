import {readFileSync} from 'node:fs'
import type {WorkOrder} from '../shared/work-order.ts'
import {type StageCluster} from '../shared/stage-clusters.ts'
// Ordem de apresentação da OS: não altera IDs ou categorias do cadastro comercial.
const PRINT_CLUSTERS:readonly StageCluster[]=[
  'Preparação técnica','Correção estrutural','Pintura e acabamento',
  'Serviços complementares','Estética e revitalização'
]

/** V63 is the visual master; replace its sample data, never the persisted scope. */
const master=readFileSync(new URL('./templates/FUNIX_OS_v63.html',import.meta.url),'utf8')
const approvedHeader=readFileSync(new URL('./templates/FUNIX_OS_v63_header.html',import.meta.url),'utf8')
const officialLogo=(()=>{const found=master.match(/<svg aria-label="FUNIX"[\s\S]*?<\/svg>/)?.[0]
 if(!found)throw Error('Marca vetorial FUNIX ausente do mestre da OS.')
 return found
})()

const css=master.match(/<style>([\s\S]*?)<\/style>/)?.[1]
const footerStart=master.indexOf('<div class="footer-legend"')
const headerStart=master.indexOf('<div class="running-header plan-header"')
const mainStart=master.indexOf('<main ')
const mainEnd=master.indexOf('</main>',mainStart)
if(!css||footerStart<0||headerStart<0||mainStart<0||mainEnd<0||
  !master.includes('<tbody>')||!master.includes('</tbody>'))
  throw Error('HTML mestre V63 inválido.')

/** Chrome prints native header/footer from a separate document context.
 * WeasyPrint @page rules in that context can paint an opaque white sheet OVER
 * the entire body PDF. Keep all visual rules, but remove @page blocks and
 * their nested margin boxes from header/footer CSS only.
 */
function withoutPageRules(source:string):string{
 let output='',cursor=0
 for(const match of source.matchAll(/@page[^{}]*\{/g)){
   const at=match.index
   if(at<cursor)continue
   output+=source.slice(cursor,at)
   let depth=1,position=at+match[0].length
   while(depth&&position<source.length){
     const current=source[position++]
     if(current==='{')depth++
     else if(current==='}')depth--
   }
   if(depth)throw Error('Regra @page incompleta no HTML da OS.')
   cursor=position
 }
 return output+source.slice(cursor)
}
const marginCss=withoutPageRules(css)
const footer=master.slice(footerStart,headerStart)
const main=master.slice(mainStart,mainEnd+7)
const icons=new Map<string,string>()
for(const svg of footer.match(/<svg\b[\s\S]*?<\/svg>/g)??[]){
 const name=svg.match(/aria-label="([^"]+)"/)?.[1]
 if(name)icons.set(name,svg)
}
const commentIcon='<svg aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M5 3h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H9l-6 4v-4a3 3 0 0 1-1-3V6a3 3 0 0 1 3-3Z"/></svg>'
const esc=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
const html=(value:string)=>esc(value||'')
function letter(index:number):string{
 let text=''
 for(let n=index+1;n>0;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text
 return text
}
function rows(order:WorkOrder):string{
 const {diagnostics,lines}=order.scope
 const ids=[...new Set([...diagnostics.map(d=>d.pieceId),...lines.map(l=>l.pieceId)])]
 return ids.map((pieceId,index)=>{
  const diag=diagnostics.find(d=>d.pieceId===pieceId)
  const items=lines.filter(l=>l.pieceId===pieceId)
  const name=diag?.pieceName||items[0]?.pieceName||'Peça não identificada'
  const symbol=letter(index),components=items.filter(l=>l.kind==='component')
  const grouped=new Map<StageCluster,string[]>(PRINT_CLUSTERS.map(c=>[c,[]]))
  const notes=[...(diag?.diagnosis?['Diagnóstico: '+diag.diagnosis]:[]),...(diag?.notes?[diag.notes]:[])]
  for(const item of items){
   if(item.kind==='component'&&item.notes)notes.push(item.name+': '+item.notes)
   if(item.kind!=='service')continue
   if(item.notes)notes.push(item.name+': '+item.notes)
   if(item.quantity!=='1')notes.push(item.name+': quantidade '+item.quantity)
   if(!item.stages.length)notes.push('Serviço sem etapas cadastradas: '+item.name)
   for(const stage of item.stages){
    // A dimensão permanece no escopo congelado; a matriz mostra apenas o nome da etapa.
    const label=stage.name
    if(stage.cluster&&grouped.has(stage.cluster))grouped.get(stage.cluster)!.push(label)
    else notes.push('Etapa sem categoria ('+item.name+'): '+label)
   }
  }
  const active=PRINT_CLUSTERS.filter(c=>grouped.get(c)!.length)
  const rowIcons=[...(components.length?['Requer componentes']:[]),...active]
    .map(category=>icons.get(category)||'').join('')
  const componentHtml=components.map((item,i)=>{
    const code=symbol+(i+1)
    const variant=i===0?' piece-ladder-code--first':i===components.length-1?' piece-ladder-code--last':''
    const quantity=item.quantity?item.quantity+' un.':''
    return '<div class="piece-ladder-code'+variant+'">'+html(code)+'</div>'+
      '<div class="piece-ladder-component'+(i===0?' piece-ladder-component--first':'')+'">'+
      '<span class="piece-ladder-desc">'+html(item.name)+'</span>'+
      '<span class="piece-ladder-qty">'+html(quantity)+'</span></div>'
  }).join('')
  const uniqueNotes=[...new Set(notes.map(note=>note.trim()).filter(Boolean))]
  const remarks=uniqueNotes.length?
    '<div class="piece-ladder-comment-marker" aria-label="Observações da peça">'+commentIcon+'</div>'+
    '<div class="piece-ladder-comment-content"><span class="piece-comment-text">'+uniqueNotes.map(html).join(' • ')+'</span></div>':''
  const first='<th class="piece-block-cell" scope="row"><div class="piece-ladder">'+
    '<span class="piece-letter">'+symbol+'</span>'+
    '<div class="piece-ladder-head"><div class="piece-ladder-name">'+html(name)+'</div>'+
    '<div class="piece-ladder-icons">'+rowIcons+'</div></div>'+
    componentHtml+remarks+'</div></th>'
  const cols=PRINT_CLUSTERS.map(category=>{
   const stages=grouped.get(category)!
   return '<td data-cluster="'+html(category)+'">'+
     (stages.length?'<ul class="service-group stage-list">'+stages.map(name=>
       '<li class="stage-entry"><span class="stage-name">'+html(name)+'</span></li>').join('')+'</ul>':
       '<span class="empty">—</span>')+'</td>'
  }).join('')
  return '<tr data-piece-ref="'+symbol+'">'+first+cols+'</tr>'
 }).join('')
}

export interface OrderPrintTemplate{content:string;headerTemplate:string;footerTemplate:string}
export function renderOrderV63(order:WorkOrder):OrderPrintTemplate{
 const vehicle=[order.scope.vehicle.description,order.scope.vehicle.plate?'('+order.scope.vehicle.plate+')':''].filter(Boolean).join(' ')
 // O modelo V63 não contém data de entrega confirmada. Prazo em dias não é
 // compromisso com data de calendário: não inferir entrega a partir da emissão.
 // Usar marcador explícito até existir data confirmada, persistida no WorkOrder.
 const delivery='-'
 const headerHtml=approvedHeader
   .replace('{{FUNIX_LOGO_SVG}}',officialLogo)
   .replace('{{OS_NUMBER}}',html(order.number))
   .replace('{{VEHICLE}}',html(vehicle||'Veículo não informado'))
   .replace('{{DELIVERY}}',html(delivery))
 const body=main.replace(/<tbody>[\s\S]*?<\/tbody>/,()=>'<tbody>'+rows(order)+'</tbody>')
 const chromePrint='@page{size:A4 landscape;margin:28mm 9mm 18mm 9mm;}'+
   'html,body{background:#fff!important} .plan-page{width:100%!important;max-width:100%!important;margin:0!important;box-shadow:none!important;}'
 const content='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>'+css+chromePrint+
   '</style></head><body>'+body+'</body></html>'
 // Chrome's separate header/footer contexts otherwise bleed to the physical A4 edges.
 // Align both to the approved V63 reference: x=5 mm, header y≈4 mm, footer y≈198 mm.
 const marginStyle='body{margin:0!important;background:transparent!important;padding:0 5mm!important;box-sizing:border-box!important}'+
   '.running-header,.footer-legend{position:static!important;width:100%!important;}'
 const wrapFooter=(body:string)=>
   '<html lang="pt-BR"><head><meta charset="utf-8"><style>'+marginCss+marginStyle+
   '.footer-legend{transform:translateY(2mm)!important;}'+
   // Original CSS shifted icon+text groups 2.6pt upward, misaligning them with 'Legenda:'.
   '.footer-legend .legend-item{transform:none!important;}'+
   '</style></head><body>'+body+'</body></html>'
 // Header is self-contained to prevent legacy V63 mast CSS from overriding
 // the approved grid. Chrome head/footer templates are distinct documents.
 const chromeHeader=headerHtml.replace('</style>',
   'body{margin:0!important;padding:0 5mm!important;background:transparent!important;box-sizing:border-box!important;}'+
   '.osv63-header{width:279mm!important;max-width:279mm!important;margin-left:auto!important;margin-right:auto!important;transform:translateY(-1.3mm)!important;}'+
   '</style>')
 return{content,headerTemplate:chromeHeader,footerTemplate:wrapFooter(footer)}
}
