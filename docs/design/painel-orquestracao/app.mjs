import {validateSnapshot,childrenOf,recordsOf,branchOf,metrics,STATUS_LABEL,KIND_LABEL,stateOfRecord,repoUrl,publishedSnapshotUrl,inspectPublishedFile} from './model.mjs';
const $=id=>document.getElementById(id);
const state={model:null,selected:null,filter:'all',expanded:false,roles:false,live:new Map(),loading:false,loadVersion:0,collapsedGroups:new Set(),raw:null,publishedSha:null};
const element=(tag,cls,content)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(content!==undefined)e.textContent=String(content);return e};
const set=(id,v)=>{$(id).textContent=String(v)};
const dt=(date)=>!date?'Não informada':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(date));
function notice(message){$('notice').hidden=!message;if(message)$('notice').textContent=message}
function topAncestor(id){let node=state.model?.byId.get(id);while(node?.parentId && state.model.byId.has(node.parentId))node=state.model.byId.get(node.parentId);return node?.id||id}
function currentNode(){return state.model?.byId.get(state.selected)}
function statusChip(node){const b=element('span','status',STATUS_LABEL[node.status]);b.dataset.status=node.status;return b}
function makeNodeCard(node, nested=false){
  const m=state.model,b=element('button',nested?'node node-inside':'node graph-top-item');
  b.type='button';b.dataset.id=node.id;b.setAttribute('aria-pressed',String(state.selected===node.id));
  const top=element('div','node-top'),ico=element('span','node-icon',node.presentation==='group'?'▣':node.title.charAt(0).toUpperCase()),name=element('strong','node-name',node.title);
  top.append(ico,name);
  const foot=element('div','node-footer'),count=element('span','node-count',`${childrenOf(m,node.id).length} subdivisões`);
  foot.append(statusChip(node),count);
  const roles=element('div','node-roles');for(const r of node.roles)roles.append(element('span','role-chip',r));
  b.append(top,element('div','node-desc',node.description||'Sem descrição registrada'),foot,roles);
  b.addEventListener('click',()=>selectNode(node.id,true));return b;
}
function makeGroup(node){
  const children=childrenOf(state.model,node.id),section=element('section','project-group graph-top-item');section.dataset.id=node.id;
  const head=element('div','project-head');
  const title=element('button','project-select');title.type='button';title.dataset.id=node.id;
  title.append(element('span','project-icon','▣'));
  const titleBlock=element('span','project-title-block');titleBlock.append(element('span','project-eyebrow',node.type||'AGRUPAMENTO'),element('strong','',node.title),element('small','',node.description||'Organização definida pelo CTO'));title.append(titleBlock);
  title.addEventListener('click',()=>selectNode(node.id,true));
  const actions=element('div','project-actions');actions.append(statusChip(node),element('span','project-count',`${children.length} ${children.length===1?'item':'itens'}`));
  const toggle=element('button','project-toggle');toggle.type='button';
  const body=element('div','project-children');body.id=`group-${state.model.nodes.indexOf(node)}`;
  for(const child of children)body.append(makeNodeCard(child,true));
  const collapsed=state.collapsedGroups.has(node.id);
  const update=()=>{body.hidden=state.collapsedGroups.has(node.id);toggle.textContent=body.hidden?'Expandir':'Recolher';toggle.setAttribute('aria-expanded',String(!body.hidden));requestAnimationFrame(drawWires)};
  toggle.setAttribute('aria-controls',body.id);toggle.addEventListener('click',()=>{if(state.collapsedGroups.has(node.id))state.collapsedGroups.delete(node.id);else state.collapsedGroups.add(node.id);update()});
  if(collapsed)body.hidden=true;update();
  actions.append(toggle);head.append(title,actions);section.append(head,body);
  return section;
}
function updateMapSelection(){
  if(!state.model)return;
  for(const node of $('node-grid').querySelectorAll('button.node,button.project-select'))node.setAttribute('aria-pressed',String(node.dataset.id===state.selected));
  for(const group of $('node-grid').querySelectorAll('.project-group'))group.dataset.active=String(topAncestor(state.selected)===group.dataset.id);
}
function renderMap(){
  const m=state.model,top=childrenOf(m,m.root.id),grid=$('node-grid');grid.replaceChildren();$('map').classList.toggle('roles-visible',state.roles);
  const groups=top.filter(x=>x.presentation==='group').length;
  set('graph-count',`${groups} ${groups===1?'grupo':'grupos'} · ${top.length} ${top.length===1?'item principal':'itens principais'}`);
  $('empty-map').hidden=top.length!==0;
  for(const node of top)grid.append(node.presentation==='group'?makeGroup(node):makeNodeCard(node));
  updateMapSelection();requestAnimationFrame(drawWires);
}
function svgLine(svg,coords,selected=false,related=false){const ns='http://www.w3.org/2000/svg',p=document.createElementNS(ns,'path');p.setAttribute('d',coords);if(selected)p.classList.add('selected');if(related)p.classList.add('related');svg.append(p)}
function drawWires(){const m=state.model;if(!m)return;const area=$('graph-body'),svg=$('wires'),grid=$('node-grid'),hub=$('hub');svg.replaceChildren();const children=[...grid.children];if(!children.length)return;const base=area.getBoundingClientRect(),h=hub.getBoundingClientRect();if(!base.width)return;const sx=h.left+h.width/2-base.left,sy=h.bottom-base.top;
  svg.setAttribute('viewBox',`0 0 ${base.width} ${base.height}`);
  for(const b of children){const q=b.getBoundingClientRect(),x=q.left+q.width/2-base.left,y=q.top-base.top,active=b.dataset.id===topAncestor(state.selected);if(window.innerWidth<=480){const spine=Math.max(4,q.left-base.left-9);svgLine(svg,`M ${sx} ${sy} V ${Math.max(sy+9,Math.min(y-3,sy+15))} H ${spine} V ${y+28} H ${q.left-base.left}`,active)}else{const d=Math.max(20,(y-sy)*.45);svgLine(svg,`M ${sx} ${sy} C ${sx} ${sy+d}, ${x} ${y-d}, ${x} ${y}`,active)}}
  const bounds=new Map(children.map(b=>[b.dataset.id,b.getBoundingClientRect()]));
  for(const rel of m.relations){const a=bounds.get(rel.from),b=bounds.get(rel.to);if(!a||!b)continue;const x1=a.right-base.left,y1=a.top+a.height/2-base.top,x2=b.left-base.left,y2=b.top+b.height/2-base.top;svgLine(svg,`M ${x1} ${y1} C ${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}`,false,true)}
}
function drawSubwires(){const root=$('subroot'),grid=$('subgrid'),svg=$('subwires'),area=$('submap');svg.replaceChildren();if($('subtree').hidden||!grid.children.length)return;const r=area.getBoundingClientRect(),a=root.getBoundingClientRect();if(!r.width)return;svg.setAttribute('viewBox',`0 0 ${r.width} ${r.height}`);const sx=a.left+a.width/2-r.left,sy=a.bottom-r.top;for(const b of grid.children){const q=b.getBoundingClientRect(),x=q.left+q.width/2-r.left,y=q.top-r.top,d=Math.max(10,(y-sy)*.44);svgLine(svg,`M ${sx} ${sy} C ${sx} ${sy+d}, ${x} ${y-d}, ${x} ${y}`,b.dataset.id===state.selected)} }
function renderDetails(){const m=state.model,node=currentNode();$('detail').hidden=!node;if(!node)return;
  set('detail-type',node.type||'TRABALHO');set('detail-title',node.title);set('detail-desc',node.description||'Sem descrição registrada');
  const ch=$('detail-status');ch.replaceWith(statusChip(node));const repl=$('detail').querySelector('.detail-top .status');repl.id='detail-status';
  set('detail-reason',node.statusReason||'Situação operacional ainda não detalhada pelo CTO.');
  set('detail-next',node.nextResult||'Próximo resultado não informado pelo CTO.');
  set('detail-blocker',node.blocker||(node.status==='bloqueado'?'Motivo do bloqueio não informado.':'Nenhum bloqueio confirmado neste registro.'));
  set('detail-updated',node.updatedAt?`Atualização do CTO: ${dt(node.updatedAt)}`:'Atualização operacional não informada');
  const roles=$('detail-roles');roles.replaceChildren();if(node.roles.length){for(const name of node.roles)roles.append(element('span','role-chip',name))}else roles.append(element('span','node-desc','Nenhum papel confirmado no registro'));
  const breadcrumbs=$('breadcrumbs');breadcrumbs.replaceChildren();const parents=branchOf(m,node.id);for(let i=0;i<parents.length;i++){if(i)breadcrumbs.append(element('span','crumb-sep','›'));const p=parents[i],btn=element('button','crumb',p.title);btn.type='button';btn.disabled=p.id===node.id;btn.addEventListener('click',()=>selectNode(p.id));breadcrumbs.append(btn)}
  const rels=state.model.relations.filter(r=>r.from===node.id||r.to===node.id),relBox=$('detail-relations');relBox.replaceChildren();$('relation-section').hidden=rels.length===0;
  for(const rel of rels){const target=state.model.byId.get(rel.from===node.id?rel.to:rel.from),b=element('button','relation-link',`${target.title}${rel.label?' · '+rel.label:''}`);b.type='button';b.addEventListener('click',()=>selectNode(target.id,true));relBox.append(b)}
  const ev=node.evidence.find(e=>e.kind==='issue'||e.kind==='pr');const link=$('detail-link');link.hidden=!ev;if(ev){link.href=repoUrl(m.repository,ev.kind,ev.number)}else link.removeAttribute('href');
  renderSubtree();renderHistory();requestAnimationFrame(()=>{drawWires();drawSubwires()});
}
function renderSubtree(){const m=state.model,node=currentNode(),kids=childrenOf(m,node.id),box=$('subtree');box.hidden=kids.length===0;if(!kids.length)return;
  set('subtree-count',`${kids.length} ${kids.length===1?'nó':'nós'}`);set('subtree-title',`Subdivisões de ${node.title}`);set('subroot',node.title);
  const grid=$('subgrid');grid.replaceChildren();grid.style.setProperty('--columns',String(Math.min(kids.length,3)));
  for(const k of kids){const b=element('button','sub-node');b.type='button';b.dataset.id=k.id;b.setAttribute('aria-pressed',String(k.id===state.selected));b.append(element('small','',k.type.toUpperCase()||'NÓ'),element('strong','',k.title),statusChip(k));if(childrenOf(m,k.id).length)b.append(element('small','',`${childrenOf(m,k.id).length} subdivisões`));b.addEventListener('click',()=>selectNode(k.id,true));grid.append(b)}
  requestAnimationFrame(drawSubwires);
}
function renderHistory(){const m=state.model,node=currentNode();if(!node)return;const all=recordsOf(m,node.id),filtered=all.filter(r=>state.filter==='all'||r.kind===state.filter),shown=state.expanded?filtered:filtered.slice(0,4);
  set('history-count',`${all.length} ${all.length===1?'registro':'registros'}`);
  for(const b of $('history-filters').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.filter===state.filter));
  const list=$('history-list');list.replaceChildren();if(!filtered.length)list.append(element('div','history-empty','Nenhum registro vinculado a esta seleção. Isso não significa ausência de trabalho no GitHub.'));
  for(const r of shown){const a=element('a','history-item');a.href=r.url;a.target='_blank';a.rel='noopener noreferrer';const tag=element('span','kind',KIND_LABEL[r.kind]);tag.dataset.kind=r.kind;const copy=element('span','history-copy'),title=element('strong','',r.title);copy.append(title);
    const key=`${r.kind}:${r.number}`,live=state.live.get(key);const details=live?.data?stateOfRecord(r,live.data):live?.error?'Estado não verificado — API indisponível':'A consultar estado atual';copy.append(element('small','',`#${r.number} · ${details}${r.context?' · '+r.context:''}`));a.append(tag,copy,element('span','history-arrow','↗'));list.append(a)}
  $('history-more').hidden=filtered.length<=4;$('history-more').textContent=state.expanded?'Mostrar menos':`Ver todos os ${filtered.length} registros`;
  set('history-source','Registros associados pelo CTO, com links públicos para o GitHub. Estado da PR/issue consultado quando a API permite; isso não comprova implantação.');
  enrich(shown);
}
async function readGithub(record){const api=record.kind==='pr'?'pulls':'issues',url=`https://api.github.com/repos/${state.model.repository}/${api}/${record.number}`;
  const res=await fetch(url,{headers:{Accept:'application/vnd.github+json'},cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);
  const v=await res.json();if(v.number!==record.number||typeof v.state!=='string')throw new Error('Resposta inesperada');return {state:v.state,merged:Boolean(v.merged),draft:Boolean(v.draft),updated_at:v.updated_at};}
async function enrich(records){const model=state.model;if(!model)return;const now=Date.now(),version=state.loadVersion;const todo=records.filter(r=>{const v=state.live.get(`${r.kind}:${r.number}`);return !v||now-v.at>300000});
  // consultas pontuais em grupos pequenos, sem credenciais ou varredura de toda a conta
  for(const r of todo.slice(0,6)){const key=`${r.kind}:${r.number}`;state.live.set(key,{pending:true,at:now});try{const live=await readGithub(r);state.live.set(key,{data:live,at:Date.now()})}catch(e){state.live.set(key,{error:true,at:Date.now()})}
    if(state.loadVersion!==version||state.model!==model)return;
  }
  // Atualiza sem reiniciar o enriquecimento das mesmas linhas.
  if(state.loadVersion===version&&state.model===model)renderHistoryNoFetch();
}
function renderHistoryNoFetch(){const previous=state.loadVersion;const m=state.model,node=currentNode();if(!node)return;const all=recordsOf(m,node.id),filtered=all.filter(r=>state.filter==='all'||r.kind===state.filter),shown=state.expanded?filtered:filtered.slice(0,4);const list=$('history-list');if(list.children.length!==shown.length)return;
  for(let i=0;i<shown.length;i++){const r=shown[i],v=state.live.get(`${r.kind}:${r.number}`),msg=v?.data?stateOfRecord(r,v.data):v?.error?'Estado não verificado — API indisponível':'A consultar estado atual';list.children[i].querySelector('small').textContent=`#${r.number} · ${msg}${r.context?' · '+r.context:''}`}
}
function selectNode(id,scroll=false){if(!state.model?.byId.has(id))return;state.selected=id;state.filter='all';state.expanded=false;updateMapSelection();renderDetails();if(scroll&&window.innerWidth<=1100)$('detail').scrollIntoView({behavior:window.matchMedia('(prefersfunction applySnapshot(raw,model,origin){
  const old=state.selected;
  state.raw=raw;state.model=model;state.loadVersion++;state.live.clear();
  state.collapsedGroups=new Set([...state.collapsedGroups].filter(x=>model.byId.has(x)&&model.byId.get(x).presentation==='group'));
  state.selected=model.byId.has(old)?old:childrenOf(model,model.root.id)[0]?.id||null;
  const mm=metrics(model);
  set('kpi-groups',mm.groups);set('kpi-cards',mm.cards);set('kpi-blocked',mm.blocked);
  set('hero-title',model.title+' · desenvolvimento');set('hero-summary',model.subtitle||'Estrutura definida pelo CTO.');
  set('hub-title',model.root.title);set('hub-subtitle',model.root.subtitle||'Coordenação técnica');
  set('snapshot-revision','Snapshot: '+model.snapshotId);
  set('source-status','Publicação: '+dt(model.publishedAt)+' (BRT) · '+origin);
  renderMap();renderDetails();if(!mm.fronts)$('detail').hidden=true;
}
async function load(){
  if(state.loading)return;state.loading=true;$('refresh').disabled=true;notice('');
  set('source-status','Carregando cópia instalada…');
  try{
    let raw;const embedded=$('embedded-snapshot');const isLocal=!/^https?:$/.test(location.protocol);
    if(isLocal&&embedded)raw=JSON.parse(embedded.textContent);
    else {const res=await fetch('./snapshot.json',{cache:'no-store'});if(!res.ok)throw new Error('Snapshot HTTP '+res.status);raw=await res.json()}
    const model=validateSnapshot(raw);state.publishedSha=null;
    applySnapshot(raw,model,isLocal&&embedded?'cópia embutida':'cópia instalada');
    set('check-status','GitHub publicado: ainda não verificado');
  }catch{
    state.model=null;state.raw=null;state.selected=null;
    set('source-status','Fonte instalada indisponível');
    set('check-status','Verificação indisponível');
    notice('Não foi possível carregar a cópia instalada. Nenhum andamento foi inferido.');
    $('node-grid').replaceChildren();$('detail').hidden=true;
    set('kpi-groups','—');set('kpi-cards','—');set('kpi-blocked','—');
  }finally{state.loading=false;$('refresh').disabled=false}
}
/** Nenhuma sincronização em segundo plano: consulta externa SOMENTE no clique. */
async function checkPublished(){
  if(state.loading||!state.model)return;
  state.loading=true;$('refresh').disabled=true;notice('');
  set('check-status','Consultando publicação no GitHub…');
  try{
    const res=await fetch(publishedSnapshotUrl(),{
      cache:'no-store',headers:{Accept:'application/vnd.github+json'},
      signal:AbortSignal.timeout(15000)
    });
    if(!res.ok)throw new Error('GitHub HTTP '+res.status);
    const candidate=inspectPublishedFile(await res.json(),state.raw,state.publishedSha);
    state.publishedSha=candidate.sha;
    if(candidate.changed){
      applySnapshot(candidate.raw,candidate.model,'GitHub publicado');
      notice('Uma nova versão validada do mapa foi carregada. Estados de tarefas não comprovam implantação.');
    }else notice('A publicação não mudou. Os cards foram mantidos.');
    set('check-status','Última verificação: '+dt(new Date().toISOString())+' (BRT)');
  }catch{
    set('check-status','Falha na verificação: '+dt(new Date().toISOString())+' (BRT)');
    notice('Não foi possível verificar a publicação no GitHub (rede, limite da API ou dados inválidos). Os cards atuais foram preservados.');
  }finally{state.loading=false;$('refresh').disabled=false}
}
$('refresh').addEventListener('click',checkPublished);
sh').disabled=false;}
}
$('refresh').addEventListener('click',load);
$('roles-toggle').addEventListener('click',()=>{state.roles=!state.roles;$('roles-toggle').setAttribute('aria-pressed',String(state.roles));$('map').classList.toggle('roles-visible',state.roles);requestAnimationFrame(drawWires)});
$('history-filters').addEventListener('click',e=>{const b=e.target.closest('button[data-filter]');if(!b)return;state.filter=b.dataset.filter;state.expanded=false;renderHistory()});
$('history-more').addEventListener('click',()=>{state.expanded=!state.expanded;renderHistory()});
window.addEventListener('resize',()=>requestAnimationFrame(()=>{drawWires();drawSubwires()}));
if('ResizeObserver' in window){const ro=new ResizeObserver(()=>requestAnimationFrame(()=>{drawWires();drawSubwires()}));ro.observe($('graph-body'));ro.observe($('submap'))}
load();
