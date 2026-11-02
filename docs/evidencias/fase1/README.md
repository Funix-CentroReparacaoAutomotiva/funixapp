# Evidências da Fase 1

Somente SQLite/API locais e dados sintéticos. Não contém exportação comercial privada, banco, senhas ou dados reais.

- `RESUMO.json`: resultados e comandos efetivamente executados.
- `npm-check.log`: build/TypeScript, 197 testes Node e lint (quatro avisos preexistentes em App.tsx).
- `deploy-tests.log`: 23 testes simulados, sem deploy.
- `browser-fase1.log` e `*-resultados.json`: 39 grupos específicos em 1440/390/320 px.
- `regressoes-resumo.json` e `regressoes-consolidadas.log`: resultados finais de 220 grupos em 16 suítes, incluindo a curadoria comercial. O log é consolidado dos JSONs finais, não uma transcrição de execução única.
- 21 screenshots: listas com cenários inversos, Mapa, Ambos, recuperação, confirmação e persistência, sete por resolução.

As regressões foram retomadas por sufixos após adequar expectativas antigas que exigiam exclusão ao desmarcar; os resultados finais de cada suíte foram conferidos individualmente. Um teste de rolagem mobile falhou uma vez; comparação com V8 original e reexecução passaram sem alteração de navegação/swipe.

[Relatório e matriz](../../FASE1_HABILITACAO_EXCLUSAO.md). Sem merge, deploy ou acesso produtivo.
