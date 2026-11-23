/** Contrato puro e verificável: nenhum domínio/projeto/frente é fixado no frontend. */
export const VALID_STATUS = new Set(['nao_verificado','planejado','acompanhamento','em_execucao','em_revisao','homologacao','bloqueado','concluido']);
export const STATUS_LABEL = Object.freeze({nao_verificado:'Não verificado',planejado:'Planejado',acompanhamento:'Em acompanhamento',em_execucao:'Em desenvolvimento',em_revisao:'Em revisão',homologacao:'Em homologação',bloqueado:'Bloqueado',concluido:'Concluído (registrado)'});
export const KIND_LABEL = Object.freeze({pr:'PR',issue:'Issue',bug:'Bug',other:'Outro'});
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const asText = (x,field,max=300) => {if(typeof x!=='string'||!x.trim()||x.length>max) throw new Error(`Campo ${field} inválido`); return x.trim()};
const optionalText = (x,field,max=500) => x==null?'':asText(x,field,max);
const validDate = x => x==null || (typeof x==='string'&&Number.isFinite(Date.parse(x)));
export const repoUrl = (repo,kind,number) => `https://github.com/${repo}/${kind==='pr'?'pull':'issues'}/${number}`;
export function safeRepoUrl(url,repo){
  try{const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='github.com'||u.username||u.password||u.port)return null;
    if(u.pathname.startsWith(`/${repo}/issues/`)||u.pathname.startsWith(`/${repo}/pull/`))return u.href;
  }catch{} return null;
}
export function validateSnapshot(raw){
  if(!isObject(raw)||raw.schemaVersion!==1)throw new Error('Versão de contrato não suportada');
  const repo=asText(raw.repository,'repository',120);
  if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo))throw new Error('Repositório inválido');
  if(!isObject(raw.root)||!Array.isArray(raw.nodes)||!Array.isArray(raw.records)||!Array.isArray(raw.relations)) throw new Error('Estrutura do snapshot inválida');
  if(raw.nodes.length>250||raw.records.length>500||raw.relations.length>400)throw new Error('Limite de dados excedido');
  if(!validDate(raw.publishedAt))throw new Error('Data de publicação inválida');
  const root={id:asText(raw.root.id,'root.id',90),title:asText(raw.root.title,'root.title'),subtitle:optionalText(raw.root.subtitle,'root.subtitle')};
  const ids=new Set([root.id]);
  const nodes=raw.nodes.map((node,i)=>{
    if(!isObject(node))throw new Error(`Nó ${i} inválido`);
    const id=asText(node.id,'node.id',90);if(ids.has(id))throw new Error('IDs duplicados');ids.add(id);
    const parentId=node.parentId==null?null:asText(node.parentId,'node.parentId',90);
    const presentation=node.presentation==null?'card':asText(node.presentation,'node.presentation',30);
    if(!['card','group'].includes(presentation))throw new Error(`Apresentação desconhecida: ${presentation}`);
    const status=asText(node.status,'node.status',30);if(!VALID_STATUS.has(status))throw new Error(`Estado desconhecido: ${status}`);
    if(!validDate(node.updatedAt))throw new Error('Data do nó inválida');
    const roles=Array.isArray(node.roles)?node.roles.map(x=>asText(x,'role',70)):[];
    if(roles.length>12)throw new Error('Número de papéis excedido');
    const evidence=Array.isArray(node.evidence)?node.evidence.map(ref=>{
      if(!isObject(ref)||!['pr','issue','bug','other'].includes(ref.kind)||!Number.isInteger(ref.number)||ref.number<1)throw new Error('Evidência inválida');
      return {kind:ref.kind,number:ref.number};
    }):[];
    if(evidence.length>30)throw new Error('Excesso de evidências por nó');
    const decisionPending=node.decisionPending==null?null:node.decisionPending;
    if(decisionPending!==null && typeof decisionPending!=='boolean')throw new Error('decisionPending deve ser booleano ou null');
    return {id,parentId,presentation,type:optionalText(node.type,'node.type',50),title:asText(node.title,'node.title'),description:optionalText(node.description,'node.description',1200),status,statusReason:optionalText(node.statusReason,'node.statusReason',700),nextResult:optionalText(node.nextResult,'nextResult',500),blocker:optionalText(node.blocker,'node.blocker',500),updatedAt:node.updatedAt||null,roles,evidence,decisionPending};
  });
  const byId=new Map(nodes.map(n=>[n.id,n]));
  for(const node of nodes){if(node.parentId!==null && node.parentId!==root.id && !byId.has(node.parentId)) throw new Error('Referência ao pai inexistente');
    let cur=node;const visited=new Set([cur.id]);while(cur?.parentId && cur.parentId!==root.id){if(visited.has(cur.parentId))throw new Error('Ciclo entre nós');visited.add(cur.parentId);cur=byId.get(cur.parentId);}}
  const refKey=new Set();
  const records=raw.records.map((r,i)=>{
    if(!isObject(r)||!byId.has(r.nodeId))throw new Error(`Vínculo técnico ${i} inválido`);
    const kind=asText(r.kind,'record.kind',25);if(!KIND_LABEL[kind])throw new Error('Tipo de registro inválido');
    if(!Number.isInteger(r.number)||r.number<1)throw new Error('Número de registro inválido');
    const title=asText(r.title,'record.title',400), context=optionalText(r.context,'record.context',300);
    const key=`${r.nodeId}:${kind}:${r.number}`;if(refKey.has(key))throw new Error('Registro duplicado no nó');refKey.add(key);
    const expected=repoUrl(repo,kind,r.number);
    if(r.url!==expected||!safeRepoUrl(r.url,repo))throw new Error('URL da evidência não corresponde ao registro');
    return {nodeId:r.nodeId,kind,number:r.number,title,context,url:expected};
  });
  const relations=raw.relations.map(r=>{
    if(!isObject(r)||!byId.has(r.from)||!byId.has(r.to)||r.from===r.to)throw new Error('Relação inválida');
    return {from:r.from,to:r.to,label:optionalText(r.label,'relation.label',120)};
  });
  return {schemaVersion:1,snapshotId:asText(raw.snapshotId,'snapshotId',120),publishedAt:raw.publishedAt||null,repository:repo,title:asText(raw.title,'title',200),subtitle:optionalText(raw.subtitle,'subtitle',500),root,nodes,records,relations,byId};
}
export function childrenOf(model,id){return model.nodes.filter(n=>(n.parentId??model.root.id)===id)}
export function subtreeIds(model,id){const out=[];const walk=(curr)=>{out.push(curr);for(const x of childrenOf(model,curr))walk(x.id)};walk(id);return out}
export function recordsOf(model,id){const ids=new Set(subtreeIds(model,id));return model.records.filter(r=>ids.has(r.nodeId))}
export function branchOf(model,id){const b=[];let cur=model.byId.get(id);while(cur){b.unshift(cur);cur=model.byId.get(cur.parentId)}return b}
export function metrics(model){const top=childrenOf(model,model.root.id);const groups=model.nodes.filter(x=>x.presentation==='group').length;return {fronts:top.length,groups,cards:model.nodes.length-groups,nodes:model.nodes.length,blocked:model.nodes.filter(x=>x.status==='bloqueado').length,unknown:model.nodes.filter(x=>x.status==='nao_verificado').length};}
/**
 * Contagens de cards: cada nó terminal de trabalho é contado uma única vez.
 * Pai com filhos representa somente a estrutura e não duplica o andamento.
 * Um valor zero só é exato quando não há folhas nao_verificado/sem campo.
 */
export function cardCounts(model, id) {
  if(!model?.byId?.has(id))throw new Error('Nó inexistente para contagem');
  const fronts=childrenOf(model,id).length;
  const leaves=subtreeIds(model,id).map(k=>model.byId.get(k))
    .filter(n=>n.presentation!=='group' && childrenOf(model,n.id).length===0);
  const statusUnknown=leaves.filter(n=>n.status==='nao_verificado').length;
  const decisionsUnknown=leaves.filter(n=>n.decisionPending===null).length;
  const metric=(value,unknown)=>Object.freeze({
    value, complete:unknown===0,
    display:unknown ? (value===0?'—':String(value)+'+') : String(value)
  });
  return Object.freeze({
    fronts,
    active:metric(leaves.filter(n=>n.status==='em_execucao').length,statusUnknown),
    blocked:metric(leaves.filter(n=>n.status==='bloqueado').length,statusUnknown),
    done:metric(leaves.filter(n=>n.status==='concluido').length,statusUnknown),
    decisions:metric(leaves.filter(n=>n.decisionPending===true).length,decisionsUnknown)
  });
}
/**
 * Resumo do PROJETO por frentes diretas, não por quantidade de tarefas.
 * Cada frente pode contribuir no máximo uma vez em cada contagem.
 * Contagens com dados parciais seguem '—' e 'N+' para não produzir falsos zeros.
 */
export function projectOverview(model,id){
  if(!model?.byId?.has(id))throw new Error('Projeto inexistente');
  const fronts=childrenOf(model,id);
  const metric=(value,unknown)=>Object.freeze({
    value,complete:unknown===0,
    display:unknown ? (value===0?'—':String(value)+'+') : String(value)
  });
  let active=0,blocked=0,unknownActive=0,unknownBlocked=0;
  const decisions=cardCounts(model,id).decisions;
  for(const front of fronts){
    const leaves=subtreeIds(model,front.id).map(k=>model.byId.get(k))
      .filter(n=>n.presentation!=='group' && childrenOf(model,n.id).length===0);
    if(leaves.length===0){unknownActive++;unknownBlocked++;continue;}
    if(leaves.some(n=>n.status==='em_execucao'))active++;
    else if(leaves.some(n=>n.status==='nao_verificado'))unknownActive++;
    if(leaves.some(n=>n.status==='bloqueado'))blocked++;
    else if(leaves.some(n=>n.status==='nao_verificado'))unknownBlocked++;
  }
  return Object.freeze({
    fronts:fronts.length,
    activeFronts:metric(active,unknownActive),
    blockedFronts:metric(blocked,unknownBlocked),
    decisions
  });
}
export function stateOfRecord(record,live){if(!live)return 'Estado atual não consultado';if(live.error)return 'Estado não verificado';if(record.kind==='pr')return live.merged?'Integrada ao GitHub':live.state==='open'?(live.draft?'PR em rascunho':'PR aberta'):'PR encerrada sem merge';return live.state==='open'?'Aberta no GitHub':'Encerrada no GitHub'}


/**
 * Canal de publicação SOB DEMANDA: a branch painel-publicado contém somente
 * dados revisados pelo CTO. Nunca usar main/HEAD nem ler URL fornecida por usuário.
 * A API pública fornece o SHA do blob; a UI só consulta quando o usuário pede.
 */
export const PUBLISHED_REPO = 'Funix-CentroReparacaoAutomotiva/funixapp';
export const PUBLISHED_BRANCH = 'painel-publicado';
export const PUBLISHED_PATH = 'docs/design/painel-orquestracao/snapshot.json';
export const publishedSnapshotUrl = () =>
  'https://api.github.com/repos/' + PUBLISHED_REPO + '/contents/' + PUBLISHED_PATH +
  '?ref=' + encodeURIComponent(PUBLISHED_BRANCH);

/** Valida metadados, conteúdo, versão e escopo ANTES de substituir a estrutura. */
export function inspectPublishedFile(file, previousRaw, knownSha = null) {
  if (!isObject(file) || file.type !== 'file' || file.path !== PUBLISHED_PATH ||
      !/^[a-f0-9]{40}$/.test(file.sha || '') || file.encoding !== 'base64' ||
      !Number.isInteger(file.size) || file.size < 1 || file.size > 300000) {
    throw new Error('Arquivo publicado inesperado ou acima do limite.');
  }
  if (knownSha && file.sha === knownSha) return {changed: false, sha: file.sha};
  if (typeof file.content !== 'string' || file.content.length > 410000) {
    throw new Error('Conteúdo publicado ausente ou acima do limite.');
  }
  let raw;
  try {
    const decoded = atob(file.content.replace(/\s/g, ''));
    const bytes = Uint8Array.from(decoded, ch => ch.charCodeAt(0));
    if (bytes.length !== file.size) throw new Error('Tamanho divergente');
    raw = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    throw new Error('Não foi possível decodificar o JSON publicado.');
  }
  const model = validateSnapshot(raw);
  const material = new Set(['em_execucao','em_revisao','homologacao','bloqueado','concluido']);
  for (const node of model.nodes) {
    if (material.has(node.status) && (!node.statusReason || !node.updatedAt || node.evidence.length === 0)) {
      throw new Error('Estado material sem justificativa, data e evidência: ' + node.id);
    }
    if (node.status === 'bloqueado' && !node.blocker) {
      throw new Error('Bloqueio sem motivo informado: ' + node.id);
    }
  }
  if (model.repository !== PUBLISHED_REPO || !model.publishedAt) {
    throw new Error('Repositório ou data de publicação inválidos.');
  }
  if (previousRaw && JSON.stringify(previousRaw) === JSON.stringify(raw)) {
    return {changed: false, sha: file.sha};
  }
  if (previousRaw?.snapshotId === raw.snapshotId) {
    throw new Error('O CTO deve alterar snapshotId ao publicar novos dados.');
  }
  if (previousRaw?.publishedAt && Date.parse(model.publishedAt) < Date.parse(previousRaw.publishedAt)) {
    throw new Error('A publicação é anterior à estrutura exibida.');
  }
  return {changed: true, sha: file.sha, raw, model};
}
