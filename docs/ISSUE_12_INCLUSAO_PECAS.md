# Issue #12 — inclusão de peças e recuperação de falhas

Base: main `ffd91f1345ad80d384370113fbeac7afa31158a6`. Branch de hotfix `fix/issue-12-inclusao-pecas`. [Issue #12](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/12) lida integralmente; sem comentários adicionais na investigação inicial. Não houve merge, deploy, acesso à VPS ou mudança de infraestrutura.

## O que foi reproduzido

### 1. Conflito gerado por resposta fora de ordem, sem outro operador

A rotina de carregamento aceitava qualquer resposta GET que terminasse, mesmo se uma consulta mais recente já tivesse atualizado a tela:

1. Ao fechar a edição, o GET de atualização lê revisão **4**; sua entrega é atrasada no teste.
2. O mesmo navegador inclui outra peça: POST **200**, banco na revisão **5**; o GET posterior atualiza a tela.
3. O GET antigo chega e repõe revisão **4** e itens antigos no estado React.
4. A inclusão seguinte envia revisão 4; o backend corretamente recusa com **409**.

Esse caminho foi executado com um único navegador gravando, respostas reais da API e banco temporário persistido. Não exige concorrência humana nem cache HTTP. Antes da proteção de ordem no carregamento, resultado final **409**; depois, a mesma reprodução termina em **200**, sem regressão dos itens. Evidências `race-before.json` e `race-after.json`.

### 2. Revisão stale real entre duas sessões

A segunda sessão grava; a primeira mantém a revisão anterior. O backend recusa a primeira tentativa e, antes da correção, tentativas seguintes permaneciam em **409**, pois não havia reconsulta. Isso também foi reproduzido. Não significa que houve outra sessão no incidente de produção; é um cenário adicional comprovado e testado.

### 3. Gravação confirmada seguida de GET com falha

Na main investigada, POST **200** com resposta válida seguido de falha no GET gerava o erro genérico de conexão e não concluía a atualização das revisões. A peça já existia no SQLite, apesar do erro exibido. Uma inclusão subsequente podia cair em **409**. O teste original confirmou a gravação no banco, não apenas uma resposta simulada. Evidência `baseline-main.json`.

Três inclusões sequenciais sem falhas passaram na base. `Cache-Control: no-store` foi verificado na API real local e já estava no servidor; esse cabeçalho não impede uma resposta em trânsito de chegar fora de ordem. Não foi demonstrado cache HTTP antigo como causa.

## Correção enxuta

- `CommercialPanel.load()`: contador local de consultas. Resposta/erro superado por uma consulta mais recente não altera estado, seleção, revisão ou mensagem. Não é nova revisão de negócio nem cache: somente ordenação de resultados assíncronos no componente existente.
- Conflito de inclusão `409/VERSION_CONFLICT`: uma reconsulta GET atualiza o workspace e permite nova tentativa **explícita**. Não há repetição automática do POST. Se a reconsulta falhar, a inclusão fica indisponível até **Atualizar dados**.
- POST com resposta válida confirmando inclusão: itens e confirmação são mantidos imediatamente. Falha posterior de GET é identificada como **falha de atualização da tela**, não fracasso da gravação. A ação de recuperação só consulta dados.
- POST sem resposta utilizável: resultado **incerto**, inclusive HTTP200 com corpo ilegível. A interface não inventa sucesso nem fracasso definitivo. Pede atualização para conferir o banco antes de tentar novamente. O teste de resposta perdida executa um POST real antes de abortar a entrega.
- **Atualizar dados** preserva o formulário local. Não rebaseia silenciosamente revisões de diagnósticos editados nem sobrepõe outra edição. Se a mesma linha tiver mudado no servidor, sua proteção de revisão continua exigindo revisão/reabertura deliberada.
- Flag síncrona durante a mutação evita dois envios antes do próximo render. `finally` libera busy também após falhas. Inclusões, gravação de diagnóstico e ações de cenário/orçamento dependentes do workspace ficam bloqueadas enquanto houver atualização pendente; campos locais e o botão de recuperação permanecem utilizáveis.
- `api.ts`: `cache: no-store`, distinção entre transporte sem resposta HTTP, erro HTTP e resposta ilegível. Detalhes sob demanda incluem método, rota com IDs substituídos por `:id` e sem query, duração até a falha, status e referência de requisição quando existentes. Cancelamento intencional permanece `AbortError`.

Nenhuma mudança em `server/commercial.ts`, controle de revisão global, transações ou unicidade física `(atendimento_id,piece_id)`. Repetir manualmente a inclusão após conferir dados é seguro por essas garantias existentes: o mesmo ID é mantido, flags anteriores não são reativadas/sobrescritas e não há nova composição. Sem fila, tabela de idempotência adicional, polling, timeout arbitrário, retry massivo, biblioteca ou refatoração geral.

## Falha de conexão de aproximadamente sete segundos

**Causa externa específica ainda não confirmada.** O relato não contém Network trace, e esta sessão não possui acesso administrativo à VPS/logs API/Traefik nem acesso HTTP ao domínio FUNIX pela política do ambiente. Não foram consultados dados pessoais, credenciais ou arquivos de ambiente reais. Nenhuma causa foi atribuída à conexão geral do proprietário, a OOM/restarts, Traefik, Cloudflare ou timeout sem evidência.

As falhas controladas provam a distinção e recuperação de GET inicial, POST, leitura de resposta do POST e GET pós-gravação. Não provam a origem da interrupção de produção. A nova identificação de fase ajuda a obter o dado mínimo restante: **horário, método, rota sem IDs/query, status ou ausência de resposta HTTP, tempo até a falha e referência de requisição quando houver**. Isso permite correlacionar uma eventual nova ocorrência com logs protegidos de API/Traefik em investigação separada de leitura. Não é necessário enviar cookies, senhas, tokens, ID de cliente ou conteúdo de Atendimento.

## Testes executados

| Verificação | Resultado |
|---|---|
| `npm run check` | Build/tipos e **59 testes Node aprovados**; lint sem erros, quatro avisos preexistentes em App.tsx |
| Scripts de implantação | **23 testes Python** aprovados, sem execução remota |
| Issue #12 Chromium | **11 grupos**, API/SQLite reais, duas sessões e desktop/mobile |
| Regressões existentes | **43 grupos**: 19 Atendimento, 8 catálogos, 3 cenários, 7 orçamento/PDF e 6 interface compacta |

Os 11 grupos cobrem: Atendimento já persistido e reinício; inclusões sequenciais; duas sessões/409/reconsulta; GET de catálogo e workspace falhando após POST válido; falha antes de entregar POST; resposta perdida após commit; HTTP200 ilegível sem falso sucesso; formulário não salvo após conflito; GET503 inicial; GET antigo fora de ordem com um só escritor; duplo clique durante POST pendente; recuperação móvel preservando todos os IDs, cenários e quantidades fracionárias. Vários casos são agrupados na mesma execução. Não houve perda ou duplicação de peças nas execuções.

Teste Node específico prova rollback no 409 e repetição manual sem mudar identidade, revisão, flags de outros cenários ou reativar uma peça desmarcada. Quatro testes do cliente verificam classificação/redação de erros, no-store, ausência de replay e cancelamento. As regressões preservam catálogos ativos/inativos, UI compacta, edição compartilhada e PDFs A/B/C/Z/AA imutáveis.

```bash
npm run check
python3 -m unittest discover -s deploy/tests -v
python3 tests/browser/issue12_inclusion.py
git diff --check
```

As regressões de navegador foram executadas sequencialmente com `m1_atendimentos`, `m1_2_catalogos`, `issue7_scenarios`, `issue7_integrated` e `pr11_interface`, substituindo seus diretórios `ARTIFACTS` por `docs/evidencias/issue12/regressoes/{m1,catalogos,cenarios,integrado,interface}` e o `REPORT` de M1.1 pelo JSON dessa pasta. Assim, as evidências anteriores não foram sobrescritas. O padrão de execução é o mesmo documentado em `PR11_INTERFACE.md`.

[Evidências](evidencias/issue12/): JSONs antes/depois, resultados, logs e capturas. São somente bancos temporários e dados sintéticos; o fault injection aborta requisições/entregas de resposta ou simula um GET503. **Todo POST bem-sucedido usa a API e o SQLite reais**; não há persistência fingida. PDFs/capturas adicionais gerados pelas regressões não são necessários neste hotfix; seus relatórios e a suíte permanecem disponíveis. Nenhum banco entra no Git.

## Arquivos e limites

- Funcionais: `src/CommercialPanel.tsx`, `src/api.ts`.
- Testes: `server/tests/client-api.test.ts`, `server/tests/commercial.test.ts`, `tests/browser/issue12_inclusion.py`.
- Este relatório e evidências. Nenhuma mudança de esquema, seed, preço, fórmula, backend produtivo, dependência, Dockerfile, Compose, workflow, VPS, DNS, Traefik, n8n, Evolution API ou Coda.

A entrega está em PR separado para auditoria. Não declara que a instabilidade externa de produção foi diagnosticada definitivamente, nem que a correção foi publicada. Sem merge ou deploy; após publicação autorizada, o navegador precisará carregar o novo frontend para usar a recuperação corrigida.
