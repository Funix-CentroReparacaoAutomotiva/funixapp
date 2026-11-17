import {readFileSync} from 'node:fs'
import type {WorkOrder} from '../shared/work-order.ts'
import {deliveryDateLabel} from '../shared/delivery-date.ts'
import {type StageCluster} from '../shared/stage-clusters.ts'
// Ordem de apresentação da OS: não altera IDs ou categorias do cadastro comercial.
const PRINT_CLUSTERS:readonly StageCluster[]=[
  'Preparação técnica','Correção estrutural','Pintura e acabamento',
  'Serviços complementares','Estética e revitalização'
]

/** V1 is the official visual master; replace its sample data, never the persisted scope. */
const master=readFileSync(new URL('./templates/FUNIX_OS_V1.html',import.meta.url),'utf8')

const css=master.match(/<style>([\s\S]*?)<\/style>/)?.[1]
const footerStart=master.indexOf('<div class="footer-legend"')
const headerStart=master.indexOf('<header ')
const mainStart=master.indexOf('<main ')
const mainEnd=master.indexOf('</main>',mainStart)
if(!css||footerStart<0||headerStart<0||mainStart<0||mainEnd<0||
  !master.includes('<tbody>')||!master.includes('</tbody>'))
  throw Error('HTML mestre V1 inválido.')

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
const footer=master.slice(footerStart,master.indexOf('</div>',footerStart)+6)
const header=master.slice(headerStart,master.indexOf('</header>',headerStart)+9)
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

function setHeaderField(source:string,field:string,value:string):string{
 const pattern=new RegExp('(<div class="field '+field+'">[\\s\\S]*?<strong class="value"(?: id="vehicle-text")?>)[\\s\\S]*?(<\\/strong>)')
 if(!pattern.test(source))throw Error('Campo '+field+' ausente do cabeçalho V1.')
 return source.replace(pattern,(_whole,start:string,end:string)=>start+html(value)+end)
}
export function renderOrderV1(order:WorkOrder):OrderPrintTemplate{
 const vehicle=[order.scope.vehicle.description,order.scope.vehicle.plate?'('+order.scope.vehicle.plate+')':''].filter(Boolean).join(' ')
 let headerHtml=setHeaderField(header,'id-field',order.number+(order.scope.deliveryDate!==undefined||order.revision?' R'+String(order.revision??1).padStart(2,'0'):''))
 headerHtml=setHeaderField(headerHtml,'vehicle-field',vehicle||'Veículo não informado')
 headerHtml=setHeaderField(headerHtml,'delivery-field',deliveryDateLabel(order.scope.deliveryDate))
 headerHtml=headerHtml.replace('class="field vehicle-field"',
   vehicle.length>=55?'class="field vehicle-field vehicle-field--long"':'class="field vehicle-field"')
 headerHtml=headerHtml.replace(/(<div class="field page-field">[\s\S]*?<strong class="value">)[\s\S]*?(<\/strong>)/,
   '$1<span class="pageNumber"></span>/<span class="totalPages"></span>$2')
 const body=main.replace(/<tbody>[\s\S]*?<\/tbody>/,()=>'<tbody>'+rows(order)+'</tbody>')
 // V1 foi fornecida com elementos fixed e overflow hidden para uma página.
 // No Chromium, somente a área da matriz flui por várias páginas.
 const chromePrint='@page plan{size:A4 landscape;margin:23mm 5mm 15mm 5mm}'+
  'html,body{height:auto!important;width:auto!important;margin:0!important;padding:0!important;overflow:visible!important;background:#fff!important;}'+
  '.plan-page{position:static!important;top:auto!important;left:auto!important;width:100%!important;max-width:100%!important;margin:0!important;padding:0!important;box-shadow:none!important;}'+
  '.execution{margin:0!important;padding:0!important;}'+
  '.main-matrix tbody tr{break-inside:avoid!important;page-break-inside:avoid!important;}'
 const content='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>'+css+chromePrint+
  '</style></head><body>'+body+'</body></html>'
 const chromeHeader='html,body{height:auto!important;width:auto!important;overflow:visible!important;margin:0!important;padding:0!important;background:transparent!important;}'+
  '.os-header{position:static!important;top:auto!important;left:auto!important;width:287mm!important;max-width:287mm!important;margin:0!important;transform:translateY(-1.3mm)!important;}'
 const chromeFooter='html,body{height:auto!important;width:auto!important;overflow:visible!important;margin:0!important;padding:0!important;background:transparent!important;}'+
  '.footer-legend{position:fixed!important;top:198.4mm!important;left:5mm!important;width:287mm!important;height:8.7mm!important;min-height:8.7mm!important;margin:0!important;transform:none!important;}'+
  '.footer-legend .legend-item{transform:none!important;}'
 const wrap=(fragment:string,extraCss:string)=>
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>'+
   marginCss+extraCss+'</style></head><body>'+fragment+'</body></html>'
 return{content,headerTemplate:wrap(headerHtml,chromeHeader),footerTemplate:wrap(footer,chromeFooter)}
}
