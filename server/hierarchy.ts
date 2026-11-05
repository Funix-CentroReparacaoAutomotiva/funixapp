import { readFileSync } from 'node:fs'
import type { HierarchyNode } from '../shared/commercial.ts'

// Exact supplied V2, packaged with the API; never fetched from Coda.
export const hierarchy = JSON.parse(readFileSync(new URL('./data/hierarquia-v2.json', import.meta.url), 'utf8')) as {
  versao: string; regioes: Record<string, HierarchyNode>; acesso_geral: HierarchyNode
}
export function hierarchyPieces() {
  const pieces = new Map<string, { code: string; name: string; side: string; suggestion: boolean }>()
  function visit(node: HierarchyNode, parent = '') {
    if (node.tipo === 'peca' && node.codigo_peca) {
      const old = pieces.get(node.codigo_peca)
      pieces.set(node.codigo_peca, { code: node.codigo_peca, name: node.lado ? `${parent} · ${node.nome}` : node.nome, side: node.lado ?? '', suggestion: Boolean(old?.suggestion || node.situacao === 'sugestao_nova') })
    }
    node.itens?.forEach(child => visit(child, node.nome))
  }
  Object.values(hierarchy.regioes).forEach(node => visit(node))
  visit(hierarchy.acesso_geral)
  return [...pieces.values()]
}

// Pair membership comes from the supplied hierarchy, never from inferred names/suffixes.
export function hierarchyPiecePairs():string[][]{
  const pairs:string[][]=[]
  const visit=(node:HierarchyNode)=>{if(node.tipo==='acao_ambos'&&node.gera_codigos_peca?.length===2)pairs.push([...node.gera_codigos_peca]);node.itens?.forEach(visit)}
  Object.values(hierarchy.regioes).forEach(visit);visit(hierarchy.acesso_geral)
  return pairs
}
