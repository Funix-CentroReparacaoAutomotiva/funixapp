/** Gate de integridade do mapa público do CTO: valida dados sem redefinir sua organização. */
import {readFileSync} from 'node:fs';
import {validateSnapshot,metrics} from './model.mjs';
const source = new URL('./snapshot.json', import.meta.url);
const raw = JSON.parse(readFileSync(source,'utf8'));
const map = validateSnapshot(raw);
const MATERIAL = new Set(['em_execucao','em_revisao','homologacao','bloqueado','concluido']);
for (const node of map.nodes) {
  if (MATERIAL.has(node.status) && (!node.statusReason || !node.updatedAt || node.evidence.length===0)) {
    throw new Error(`${node.id}: estado material exige justificativa, data e evidência`);
  }
  if (node.status==='bloqueado' && !node.blocker) {
    throw new Error(`${node.id}: bloqueio exige motivo`);
  }
}
if(map.repository!=='Funix-CentroReparacaoAutomotiva/funixapp') {
  throw new Error('O painel público está restrito ao repositório FUNIX autorizado');
}
const counts=metrics(map);
console.log(`SNAPSHOT_OK: ${counts.fronts} frentes, ${counts.nodes} nós, ${map.records.length} registros, ${counts.blocked} bloqueados`);