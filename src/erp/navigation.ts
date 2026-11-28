export const modules = [
  { id: 'vendas', label: 'Vendas', icon: 'vendas', links: [
    ['/vendas/desempenho', 'Desempenho'], ['/vendas/funil', 'Funil'],
    ['/vendas/acompanhamento', 'Acompanhamento'], ['/conversas', 'Conversas'],
  ] },
  { id: 'oficina', label: 'Oficina', icon: 'oficina', links: [
    ['/oficina/patio', 'Pátio'], ['/oficina/planejamento', 'Planejamento'],
  ] },
  { id: 'estoque', label: 'Estoque', icon: 'estoque', links: [
    ['/estoque/insumos', 'Insumos'], ['/estoque/tintas', 'Tintas'], ['/estoque/movimentacoes', 'Movimentações'],
  ] },
  { id: 'financeiro', label: 'Financeiro', icon: 'financeiro', links: [
    ['/financeiro/contas-a-receber', 'A receber'], ['/financeiro/contas-a-pagar', 'A pagar'], ['/financeiro/fluxo-de-caixa', 'Fluxo de caixa'],
  ] },
  { id: 'biblioteca', label: 'Biblioteca', icon: 'biblioteca', links: [['/biblioteca/historico', 'Histórico']] },
  { id: 'gestao', label: 'Gestão', icon: 'gestao', links: [
    ['/gestao/configuracoes', 'Configurações'], ['/gestao/sac', 'SAC'], ['/atualizacoes', 'Atualizações'],
  ] },
] as const

export type Workspace = typeof modules[number]
const extraPages = new Set(['/inicio', '/tarefas/painel', '/tarefas/catalogo'])
const legacyPages = new Map([
  ['/funil', '/vendas/funil'],
  ['/operacao', '/oficina/patio'],
  ['/financeiro', '/financeiro/contas-a-receber'],
  ['/configuracoes', '/gestao/configuracoes'],
])
export const selectedPage = (path: string) => legacyPages.get(path) ?? path

export function workspaceFor(path: string) {
  return modules.find(module => module.links.some(([href]) => href === selectedPage(path)))
}

export function erpRoute(path: string) {
  const [, area, view = ''] = path.split('/')
  if (extraPages.has(path) || (view && workspaceFor(path) && !legacyPages.has(path))) return { area, view }
  return null
}

const storageKey = 'funix-workspace-pages'
type WorkspaceMemory = { active?: Workspace['id']; pages?: Partial<Record<Workspace['id'], string>> }

function readMemory(): WorkspaceMemory {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? 'null') ?? {}
  } catch { return {} }
}

export function rememberPage(path: string) {
  const module = workspaceFor(path)
  if (!module) return
  try {
    const memory = readMemory()
    localStorage.setItem(storageKey, JSON.stringify({
      active: module.id,
      pages: { ...memory.pages, [module.id]: selectedPage(path) },
    }))
  } catch { /* Storage can be disabled by the browser. */ }
}

export function preferredPage(module?: Workspace) {
  const memory = readMemory()
  const target = module ?? modules.find(item => item.id === memory.active) ?? modules[0]
  const saved = memory.pages?.[target.id]
  return target.links.find(([path]) => path === saved)?.[0] ?? target.links[0][0]
}
