# Validação do primeiro incremento — 21/10/2026

Estado: TESTADO localmente, não HOMOLOGADO.

## Verificações finais

`npm run check` terminou com código 0 após as últimas alterações. Inclui:

- Build React/TypeScript e bundle Vite: aprovado.
- Tipagem do backend: aprovada.
- Testes Node: **12 testes, 12 aprovados**, usando `--test-isolation=none` para exibir explicitamente cada caso neste ambiente.
- Oxlint: nenhum erro; quatro avisos `react/set-state-in-effect` nos resets de preparação de consultas assíncronas. Esses efeitos têm dependências estáveis e cancelamento; os avisos não foram suprimidos globalmente.

## HTTP local real

Foram iniciados Vite `127.0.0.1:5173` e API `127.0.0.1:8787`. A leitura de `/api/health`, `/api/session`, index e proxy do Vite retornou 200. O health informa configuração Coda ausente; não afirma conectividade remota.

Um teste com socket real, senha exclusivamente sintética e repositório sem credenciais confirmou:

| Operação | Resultado |
|---|---|
| Consulta sem sessão | 401 AUTH_REQUIRED |
| Login válido local | 200; cookie de sessão |
| Consulta sem token Coda | 503 CODA_NOT_CONFIGURED |
| PATCH de Experiência | 405 READ_ONLY |
| Logout | 200; sessão revogada |
| Consulta após logout | 401 AUTH_REQUIRED |

Nenhum token, cookie de sessão ou senha foi incluído no relatório. Os serviços locais são encerrados após a revisão; o README permite reiniciá-los.

## Navegador

**59/59 verificações** em Chromium desktop 1440×960 e celular 390×844, sem erros JavaScript de página. Detalhes em `VALIDACAO_BROWSER.md`; resultados em `evidencias/QA_RESULTADOS.json`.

O estado sem configuração foi verificado contra o backend local real. Os cenários de dados, busca, cards, Histórico pendente e falhas usam API sintética interceptada, com identificação TESTE. Não são evidência de integração contínua com produção. A V20 original também foi aberta e explorada separadamente, conforme `design/REVISAO_V20.md`.

Foram observados retorno com busca/modo/colapso e scroll preservados, Back/Forward, headers de duas entidades distintas, Experiência→Atendimento, descarte de paginação tardia, sessão expirada, 404/409/503 e busca progressiva sem falso resultado global.

## Não verificado ou não habilitado

- Token e rede do processo Node para Coda; equivalência REST das views e serialização remota das referências.
- Latência e limite real da estratégia de hidratação por página; autorização nominal/papéis e hospedagem.
- Chat N:N, mensagens reais, escrita de diagnóstico, agendamento, PDF/OS, financeiro, entrada/saída e transições operacionais.
- Homologação manual completa de gestos/acessibilidade e validação por operadores.

A investigação dos conectores comprovou estruturas e históricos existentes. Ela não substitui essas verificações da aplicação. Nenhuma alteração produtiva foi executada.
