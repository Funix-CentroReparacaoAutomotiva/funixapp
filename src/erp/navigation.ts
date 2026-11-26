export const erpSections = [
  { label: 'Início', links: [['/inicio', 'Início']] },
  { label: 'Tarefas', links: [['/tarefas/painel', 'Painel de tarefas'], ['/tarefas/catalogo', 'Catálogo de tarefas']] },
  { label: 'Vendas', links: [['/vendas/desempenho', 'Desempenho'], ['/vendas/funil', 'Funil de vendas'], ['/vendas/acompanhamento', 'Acompanhamento de veículos']] },
  { label: 'Oficina', links: [['/oficina/patio', 'Pátio'], ['/oficina/planejamento', 'Planejamento']] },
  { label: 'Estoque', links: [['/estoque/insumos', 'Insumos'], ['/estoque/tintas', 'Tintas'], ['/estoque/movimentacoes', 'Movimentações']] },
  { label: 'Financeiro', links: [['/financeiro/contas-a-receber', 'Contas a receber'], ['/financeiro/contas-a-pagar', 'Contas a pagar'], ['/financeiro/fluxo-de-caixa', 'Fluxo de caixa']] },
  { label: 'Biblioteca', links: [['/biblioteca/historico', 'Histórico de experiências']] },
  { label: 'Gestão', links: [['/gestao/sac', 'SAC'], ['/gestao/configuracoes', 'Configurações']] },
] as const

export function erpRoute(path: string) {
  for (const section of erpSections) {
    for (const [href] of section.links) {
      if (href !== path) continue
      const [, area, view = ''] = href.split('/')
      return { area, view }
    }
  }
  return null
}
