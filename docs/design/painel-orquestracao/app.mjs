/** FUNIX ERP — painel executivo somente leitura. Sem inferência de progresso operacional. */
export const REPO = 'Funix-CentroReparacaoAutomotiva/funixapp';
export const FRONTS = Object.freeze([
  {id:291,name:'Plataforma',description:'Segurança, ambientes, qualidade e governança.',glyph:'P',epics:[299,301,302,303]},
  {id:292,name:'Operação',description:'Atendimento, planejamento e execução na oficina.',glyph:'O',epics:[305,310]},
  {id:293,name:'Comercial',description:'Cadastro, catálogo, orçamento e histórico comercial.',glyph:'C',epics:[297,300,304]},
  {id:294,name:'WhatsApp',description:'Conversas vinculadas aos Atendimentos e segurança de identidade.',glyph:'W',epics:[298,307,311]},
  {id:295,name:'Documentos',description:'OS, PDFs, revisões e comunicação com o cliente.',glyph:'D',epics:[312,313]},
  {id:296,name:'Integrações e IA',description:'Copilotos e integrações controladas com sistemas externos.',glyph:'I',epics:[306,309]}
]);
export const EXPECTED_IDS = Object.freeze(FRONTS.flatMap(f=>[f.id,...f.epics]));
export function cleanIssues(items){return (Array.isArray(items)?items:[]).filter(x=>x&&Number.isInteger(x.number)&&!x.pull_request&&EXPECTED_IDS.includes(x.number))}
export function isBlocked(issue){return Boolean(issue?.labels?.some(l=>/^(blocked|bloqueado|impedido)$/i.test(typeof l==='string'?l:l?.name||'')))}
export function statusOf(issue){
  if(!issue)return {key:'unknown',label:'Estado não verificado'};
  if(issue.state==='closed')return {key:'closed',label:'Encerrada no GitHub'};
  if(issue.state!=='open')return {key:'unknown',label:'Estado não verificado'};
  if(isBlocked(issue))return {key:'blocked',label:'Bloqueio sinalizado'};
  return {key:'open',label:'Em acompanhamento'};
}
export function mapData(items){
  const byId=new Map(cleanIssues(items).map(x=>[x.number,x]));
  return FRONTS.map(front=>{
    const issue=byId.get(front.id);
    const epics=front.epics.map(id=>({id,issue:byId.get(id)}));
    const updated=[issue,...epics.map(x=>x.issue)].filter(Boolean).map(x=>x.updated_at).filter(Boolean).sort().reverse()[0]||null;
    return {...front,issue,epics,updated,status:statusOf(issue),validEpics:epics.filter(x=>x.issue).length,explicitBlocks:[issue,...epics.map(x=>x.issue)].filter(isBlocked).length};
  });
}
export function summaryOf(model){
  const all=model.flatMap(f=>[f.issue,...f.epics.map(e=>e.issue)]).filter(Boolean);
  return {tracked:all.length,blocked:all.filter(isBlocked).length,latest:all.map(x=>x.updated_at).filter(Boolean).sort().reverse()[0]||null};
}
export function recentRecords(model,limit=5){
  return model.flatMap(f=>[f.issue,...f.epics.map(e=>e.issue)].filter(Boolean))
    .filter(x=>x?.updated_at&&Number.isFinite(Date.parse(x.updated_at)))
    .sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at))
    .slice(0,limit);
}
export function parseIssueSearch(payload){
  if(!payload||!Array.isArray(payload.items)||payload.incomplete_results===true||!Number.isInteger(payload.total_count))throw new Error('Busca incompleta ou formato inválido');
  if(payload.items.length<payload.total_count)throw new Error('A busca excedeu a página disponível');
  const found=cleanIssues(payload.items);
  if(EXPECTED_IDS.some(id=>!found.some(x=>x.number===id)))throw new Error('Uma ou mais iniciativas/linhas não foram retornadas');
  return found;
}
export function formattedDate(date){
  if(!date||!Number.isFinite(Date.parse(date)))return 'data não informada';
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date(date));
}
export function safeGitHubUrl(url){
  try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='github.com'&&!u.username&&!u.password&&!u.port?u.href:null}catch{return null}
}
const API=`https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${REPO} is:issue in:title "INITIATIVE" OR "EPIC"`)}&per_page=100`;
const issueURL=id=>`https://github.com/${REPO}/issues/${id}`;
const el=id=>document.getElementById(id);
const text=(element,value)=>{element.textContent=String(value)};
const make=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n};
const link=(url,label)=>{const a=make('a','',label);a.href=safeGitHubUrl(url)||'#';a.target='_blank';a.rel='noopener noreferrer';return a};
let currentFront=294,requestActive=false;
function renderFronts(model){
  const wrap=el('front-grid');wrap.replaceChildren();
  for(const item of model){
    const btn=make('button','front-card');btn.type='button';btn.dataset.front=String(item.id);btn.setAttribute('aria-pressed',String(item.id===currentFront));btn.setAttribute('aria-controls','details');
    const head=make('div','node-heading');head.append(make('div','node-icon',item.glyph));
    const name=make('div');name.append(make('div','node-name',item.name),make('div','node-number',`Iniciativa #${item.id}`));head.append(name);
    btn.append(head,make('span','node-arrow','↗'));
    const state=make('div','node-status',item.status.label);state.dataset.status=item.status.key;btn.append(state);
    btn.append(make('div','node-meta',item.issue?`${item.validEpics} linhas rastreadas · registro atualizado em ${formattedDate(item.updated)}`:'Dados não verificados'));
    btn.addEventListener('click',()=>{currentFront=item.id;renderFronts(model);renderDetails(item)});
    wrap.append(btn);
  }
}
function renderDetails(item){
  text(el('details-title'),item.name);text(el('details-description'),item.description);
  const view=el('details-link');view.hidden=!item.issue;if(item.issue)view.href=issueURL(item.id);
  const box=el('details-info');box.replaceChildren();
  const tags=make('div','detail-tags');
  tags.append(make('span','detail-tag',item.status.label),make('span','detail-tag',`${item.validEpics} linhas com registro`),make('span','detail-tag',`Última edição: ${formattedDate(item.updated)}`));
  box.append(tags,make('h3','','Linhas de trabalho registradas no GitHub'));
  const list=make('div','epic-list');
  for(const {id,issue} of item.epics){
    const line=make('div','epic');line.append(link(issueURL(id),issue?.title?.replace(/^EPIC:\s*/,'')||`Issue #${id} · informação indisponível`),make('span','epic-status',issue?statusOf(issue).label:'Não verificada'));list.append(line);
  }
  box.append(list);
  box.append(make('p','muted','As datas indicam alterações nos registros, não avanço comprovado de código. O GitHub não informa, por si só, se uma entrega está homologada ou publicada.'));
}
function renderActivity(model){
  const list=el('activity-list');list.replaceChildren();const recent=recentRecords(model);
  if(recent.length===0){list.append(make('li','muted','Movimentações não verificadas.'));return}
  for(const record of recent){
    const li=make('li');li.append(make('span','activity-indicator'));
    const c=make('div','activity-content');c.append(link(issueURL(record.number),record.title||`Registro #${record.number}`),make('span','activity-sub',`${statusOf(record).label} · alteração do registro, não entrega confirmada`));
    li.append(c,make('span','activity-date',formattedDate(record.updated_at)));list.append(li);
  }
}
function render(model){
  renderFronts(model);renderDetails(model.find(x=>x.id===currentFront)||model[0]);renderActivity(model);
  const summary=summaryOf(model);
  text(el('metric-blocked'),summary.tracked===0?'—':String(summary.blocked));
  text(el('metric-tracked'),summary.tracked===0?'—':String(summary.tracked));
}
async function readIssues(){
  const response=await fetch(API,{headers:{Accept:'application/vnd.github+json'},cache:'no-store'});
  if(!response.ok)throw new Error(`GitHub HTTP ${response.status}`);
  return parseIssueSearch(await response.json());
}
async function refresh(){
  if(requestActive)return;requestActive=true;el('refresh').disabled=true;text(el('data-status'),'Atualizando fonte…');
  const notice=el('notice');notice.hidden=true;
  try{
    render(mapData(await readIssues()));
    text(el('data-status'),`Consulta: ${new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date())} (BRT)`);
  }catch(e){
    render(mapData([]));text(el('data-status'),'Dados não verificados');
    text(notice,'Não foi possível confirmar os registros atuais pelo GitHub. As frentes abaixo são apenas o mapa de referência; tente atualizar novamente.');notice.hidden=false;
  }finally{requestActive=false;el('refresh').disabled=false}
}
if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',()=>{render(mapData([]));el('refresh').addEventListener('click',refresh);refresh()});