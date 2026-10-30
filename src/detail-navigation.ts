export type DetailScreen = 'peca' | 'comparacao' | 'orcamentos'
export const detailScreen = (search: string): DetailScreen | null => {
  const value = new URLSearchParams(search).get('tela')
  return value === 'peca' || value === 'comparacao' || value === 'orcamentos' ? value : null
}
export function parentDetail(search: string) {
  const params = new URLSearchParams(search)
  if (params.get('tela') === 'orcamentos' && params.has('versao')) params.delete('versao')
  else { params.delete('tela'); params.delete('peca'); params.delete('versao') }
  return params.toString()
}
export function swipeTab(tab: string, dx: number, dy: number, elapsed: number) {
  if (elapsed > 800 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return null
  const tabs = ['chat', 'diagnosticos', 'mapa'], index = tabs.indexOf(tab) + (dx < 0 ? 1 : -1)
  return index >= 0 && index < tabs.length ? tabs[index] : null
}
