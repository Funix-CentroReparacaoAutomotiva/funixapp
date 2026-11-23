import {validateSnapshot,childrenOf,recordsOf,branchOf,metrics,STATUS_LABEL,KIND_LABEL,stateOfRecord,repoUrl,publishedSnapshotUrl,inspectPublishedFile,cardCounts,projectOverview} from './model.mjs';
const $=id=>document.getElementById(id);
const state={model:null,selected:null,filter:'all',expanded:false,roles:false,live:new Map(),loading:false,loadVersion:0,collapsedGroups:new Set(),raw:null,publishedSha:null};
const element=(tag,cls,content)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(content!==undefined)e.textContent=String(content);return e};
const set=(id,v)=>{$(id).textContent=String(v)};
const dt=(date)=>!date?'Não informada':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(date));
function notice(message){$('notice').hidden=!message;if(message)$('notice').textContent=message}
function topAncestor(id){let node=state.model?.byId.get(id);while(node?.parentId && state.model.byId.has(node.parentId))node=state.model.byId.get(node.parentId);return node?.id||id}
function currentNode(){return state.model?.byId.get(state.selected)}
function statusChip(node){const b=element('span','status',STATUS_LABEL[node.status]);b.dataset.status=node.status;return b}

const metricPaths={
  fronts:['M6 3v12a4 4 0 0 0 4 4h8','M6 12h9a4 4 0 0 0 4-4V5'],
  decisions:['M12 2 3 12l9 10 9-10-9-10Z','M12 8v5','M12 16h.01'],
  active:['m10 8 6 4-6 4z'],
  date:['M12 6v6l4 2'],
  activeFronts:['M4 7l8-4 8 4-8 4-8-4Z','M4 12l8 4 8-4','M4 17l8 4 8-4'],
  blockedFronts:['M4 4h16v16H4z','M12 8v5','M12 16h.01'],
  blocked:['m12 3 10 18H2L12 3Z','M12 9v5','M12 17h.01'],
  done:['m7.5 12 3 3 6-7']
};
function metricIcon(kind) {
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
  svg.setAttribute('focusable','false');
  if(kind==='active'||kind==='date'||kind==='done'){
    const c=document.createElementNS(ns,'circle');c.setAttribute('cx','12');c.setAttribute('cy','12');c.setAttribute('r','9');svg.append(c);
  }
  for(const d of metricPaths[kind]){const p=document.createElementNS(ns,'path');p.setAttribute('d',d);svg.append(p);}
  return svg;
}
function shortPublishedDate(value){
  if(!value||!Number.isFinite(Date.parse(value)))return '—';
  const day=d=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);return [parts.find(p=>p.type==='year').value,parts.find(p=>p.type==='month').value,parts.find(p=>p.type==='day').value].join('-')};
  const a=day(new Date()),b=day(new Date(value));
  // Formato en-CA gera AAAA-MM-DD. Ignorar horas para evitar diferencas na virada do dia.
  const parse=s=>{const [y,m,d]=s.split('-').map(Number);return Date.UTC(y,m-1,d)};
  const diff=Math.round((parse(a)-parse(b))/86400000);
  if(diff===0)return 'hoje';
  if(diff===1)return 'ontem';
  if(diff>1)return 'há '+diff+' dias';
  return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit'}).format(new Date(value));
}
function appendCompactCard(button,node,project=false){
  const counts=project?projectOverview(state.model,node.id):cardCounts(state.model,node.id);
  const head=element('span','card-head'),left=element('span','name-and-status');
  if(project)left.append(element('span','project-label','PROJETO'));
  left.append(element('strong','node-name',node.title));
  const status=element('span','card-status');status.dataset.state=node.status;
  status.title='Situação: '+STATUS_LABEL[node.status];
  status.append(element('span','status-dot'));left.append(status);
  const updated=element('span','updated-top');updated.append(metricIcon('date'),element('span','',shortPublishedDate(state.model.publishedAt)));
  updated.title='Publicação dos dados: '+dt(state.model.publishedAt);
  head.append(left,updated);
  const metrics=element('span','mini-metrics');
  const specs=project?[
    ['fronts','Frentes diretas',{display:String(counts.fronts),complete:true}],
    ['activeFronts','Frentes com atividade confirmada',counts.activeFronts],
    ['blockedFronts','Frentes com bloqueio confirmado',counts.blockedFronts],
    ['decisions','Decisões pendentes nos trabalhos',counts.decisions]
  ]:[
    ['fronts','Frentes diretas',{display:String(counts.fronts),complete:true}],
    ['decisions','Decisões pendentes',counts.decisions],
    ['active','Trabalhos ativos',counts.active],
    ['blocked','Trabalhos bloqueados',counts.blocked],
    ['done','Trabalhos concluídos',counts.done]
  ];
  const spoken=[];
  for(const [kind,label,m] of specs){
    const item=element('span','stat '+kind),num=element('span','num',m.display);
    const description=m.complete?label+': '+m.display:(
      m.value===0?label+': não verificado':label+': pelo menos '+m.value+' confirmado(s), há registros não verificados'
    );
    item.title=description;item.append(metricIcon(kind),num);metrics.append(item);spoken.push(description);
  }
  button.setAttribute('aria-label',node.title+'. '+STATUS_LABEL[node.status]+
      '. Publicação: '+shortPublishedDate(state.model.publishedAt)+'. '+spoken.join('. ')+'. Abrir detalhes.');
  button.classList.toggle('project-summary',project);
  button.append(head,metrics);
}
function makeNodeCard(node,nested=false){
  const button=element('button',nested?'node node-inside':'node graph-top-item');
  button.type='button';button.dataset.id=node.id;
  button.setAttribute('aria-pressed',String(state.selected===node.id));
  appendCompactCard(button,node);
  button.addEventListener('click',()=>selectNode(node.id));
  return button;
}
function makeTreeBranch(node){
  const branch=element('div','tree-branch');
  branch.append(makeNodeCard(node,true));
  const kids=childrenOf(state.model,node.id);
  if(kids.length){
    const list=element('div','branch-children');
    list.id='tree-children-'+state.model.nodes.indexOf(node);
    list.hidden=true;
    for(const child of kids)list.append(makeTreeBranch(child));
    const toggle=element('button','branch-toggle','+');
    toggle.type='button';toggle.setAttribute('aria-label','Mostrar subdivisões de '+node.title);
    toggle.setAttribute('aria-controls',list.id);toggle.setAttribute('aria-expanded','false');
    toggle.addEventListener('click',()=>{
      list.hidden=!list.hidden;const open=!list.hidden;
      toggle.textContent=open?'−':'+';toggle.setAttribute('aria-expanded',String(open));
      toggle.setAttribute('aria-label',(open?'Ocultar':'Mostrar')+' subdivisões de '+node.title);
      requestAnimationFrame(drawWires);
    });
    branch.append(toggle,list);
  }
  return branch;
}
function makeGroup(node){
  const children=childrenOf(state.model,node.id),section=element('section','project-group graph-top-item');
  section.dataset.id=node.id;
  const head=element('div','project-head');
  const title=element('button','project-select');
  title.type='button';title.dataset.id=node.id;
  title.setAttribute('aria-pressed',String(state.selected===node.id));
  appendCompactCard(title,node,true);
  title.addEventListener('click',()=>selectNode(node.id));
  const toggle=element('button','project-toggle');
  toggle.type='button';toggle.hidden=children.length===0;
  const body=element('div','project-children');body.id='group-'+state.model.nodes.indexOf(node);
  for(const child of children)body.append(makeTreeBranch(child));
  const update=()=>{
    body.hidden=state.collapsedGroups.has(node.id);
    toggle.textContent=body.hidden?'+ Mostrar frentes':'− Recolher frentes';
    toggle.setAttribute('aria-expanded',String(!body.hidden));
    requestAnimationFrame(drawWires);
  };
  toggle.setAttribute('aria-controls',body.id);
  toggle.addEventListener('click',()=>{
    if(state.collapsedGroups.has(node.id))state.collapsedGroups.delete(node.id);
    else state.collapsedGroups.add(node.id);
    update();
  });
  head.append(title,toggle);section.append(head,body);
  update();
  return section;
}
function updateMapSelection(){
  if(!state.model)return;
  for(const node of $('node-grid').querySelectorAll('button.node,button.project-select'))node.setAttribute('aria-pressed',String(node.dataset.id===state.selected));
  for(const group of $('node-grid').querySelectorAll('.project-group'))group.dataset.active=String(topAncestor(state.selected)===group.dataset.id);
}
function renderMap(){
  const m=state.model,top=childrenOf(m,m.root.id),grid=$('node-grid');grid.replaceChildren();
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
function renderDetails(){const m=state.model,node=currentNode();if(!node)return;
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
function selectNode(id){
  if(!state.model?.byId.has(id))return;
  const dialog=$('detail');
  if(!dialog.open)state.lastTrigger=document.activeElement;
  state.selected=id;state.filter='all';state.expanded=false;
  updateMapSelection();renderDetails();
  if(!dialog.open)dialog.showModal();
}
function applySnapshot(raw,model,origin){
  const selected=state.selected;
  state.raw=raw;state.model=model;state.loadVersion++;state.live.clear();
  state.collapsedGroups=new Set([...state.collapsedGroups].filter(x=>model.byId.has(x)&&model.byId.get(x).presentation==='group'));
  state.selected=selected&&model.byId.has(selected)?selected:null;
  set('hub-title',model.root.title);set('hub-subtitle',model.root.subtitle||'Coordenação técnica');
  set('snapshot-revision','Snapshot: '+model.snapshotId);
  set('source-status','Publicação: '+dt(model.publishedAt)+' (BRT) · '+origin);
  renderMap();
  if($('detail').open){
    if(state.selected)renderDetails();
    else $('detail').close();
  }
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
    $('node-grid').replaceChildren();if($('detail').open)$('detail').close();
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
$('detail-close').addEventListener('click',()=>$('detail').close());
$('detail').addEventListener('close',()=>{
  state.selected=null;updateMapSelection();
  state.lastTrigger?.focus?.();
});

$('history-filters').addEventListener('click',e=>{const b=e.target.closest('button[data-filter]');if(!b)return;state.filter=b.dataset.filter;state.expanded=false;renderHistory()});
$('history-more').addEventListener('click',()=>{state.expanded=!state.expanded;renderHistory()});
window.addEventListener('resize',()=>requestAnimationFrame(()=>{drawWires();drawSubwires()}));
if('ResizeObserver' in window){const ro=new ResizeObserver(()=>requestAnimationFrame(()=>{drawWires();drawSubwires()}));ro.observe($('graph-body'));ro.observe($('submap'))}
load();
