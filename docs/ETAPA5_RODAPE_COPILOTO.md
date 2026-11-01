# Issue #31 — Etapa 5/6: rodapé, emissão e Copiloto

Base auditada `e4837f513ca44bc7fc75df1a6f05013e53be8856`; branch `feature/revisao-integrada-funix`. Escopo F01–F06, após [aprovação da Etapa 4](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/31#issuecomment-6553127271). Sem merge/deploy, alteração de produção ou início da Etapa 6.

## Matriz F01–F06

| ID | Resultado | Implementação e evidência |
| --- | --- | --- |
| F01 | Atendido | Orçamentos emitidos na faixa inferior/esquerda, visível também com painel recolhido. Reutiliza `onView('orcamentos')`, lista/versão/PDF e retorno contextual existentes; acesso no menu de cenários permanece. |
| F02 | Atendido | Não existe botão Conferir prévia. Emitir obtém a prévia técnica/token internamente e abre a confirmação já existente, sem uma ação prévia separada do operador. |
| F03 | Atendido | Emitir orçamento à direita, na faixa fixa de ações, fora da área recolhível/rolável. Consentimento, revisão, token, chave idempotente, bloqueios e proteção contra duplo clique preservados. |
| F04 | Atendido | Botão Copiloto ancorado à base/safe-area, mesma posição nas três abas e nos dois estados financeiros. Apenas o balão aberto se acomoda acima do rodapé; não desloca o botão. |
| F05 | Atendido | Área lateral reservada para o botão; Total final fica à esquerda dessa reserva. Botões, valores e balão não se sobrepõem. Resumo/seletores em duas colunas no mobile e conteúdo financeiro rolável com ações sempre visíveis. |
| F06 | Preservado | Copiloto continua explicitamente indisponível, com o mesmo contexto e conteúdo. Sem chamadas/integrações de IA ou WhatsApp e sem simulação. |

## Alterações por arquivo e justificativa

- **`src/FinancialPanel.tsx`:** ações movidas para um rodapé fora do `hidden` do corpo financeiro; histórico reutiliza callback da rota atual; remoção do botão redundante. Erros/reauth/recarregamento continuam visíveis quando a prévia falha com painel recolhido. A função de início da emissão sempre pede a prévia técnica e abre confirmação; não há nova via de emissão.
- **`src/CommercialPanel.tsx`:** um contêiner flex comum mantém o mesmo painel financeiro nas três abas, inclusive Chat. Evita rodapés/instâncias paralelos e preserva o estado de expansão ao alternar abas. Histórico e comparação continuam telas próprias, sem rodapé duplicado. Reutiliza callback/guards, contexto de cenário, mesma fila e estados aprovados.
- **`src/App.tsx`:** mede altura do rodapé somente para posicionar o balão aberto acima dele. O botão não depende dessa medida. Sem alteração nos guards, funções ou integrações do Copiloto.
- **`src/footer-copilot.css`:** geometria específica do rodapé/Copiloto, área reservada, safe-area, scroll financeiro, controles principais ≥44 px e mensagem de indisponibilidade compacta no balão. Cor/linguagem visual existentes preservadas. A composição de Chat deixa de reservar à direita um espaço antigo que já não pertence ao Copiloto.
- **`docs/API.md` e `AGENTS.md`:** texto atualizado para a autorização/UI vigente; endpoints e contrato técnico de prévia/emissão permanecem iguais.
- **QA:** `tests/browser/etapa5_rodape.py`, runner `etapa5_regressions.py`, relatório/evidências. Duas suítes antigas recebem ajustes apenas nas expectativas superadas: posição do Copiloto (agora na base, em vez de acima do painel) e botão de prévia removido/geometria financeira responsiva. Asserções financeiras, de consentimento, autenticação, idempotência, integridade e PDF permanecem.

## Emissão e recuperação

O mesmo fluxo `obtain` confere assinatura/intenção e revisões de composição, cenário e configuração contra a prévia recebida. O backend continua validando token/cálculo numa transação e reutilizando a emissão existente para a mesma chave. Nenhuma mudança em `server/budgets.ts`, motor, PDF, SQLite ou migrações.

Emitir abre a confirmação com a prévia oficial internamente obtida. A confirmação expressa existente permanece obrigatória; isso não é um botão/etapa manual adicional de Conferir prévia. Preço/energia/prazo inválidos continuam impedindo emissão pelo motor oficial.

Falha antes da prévia: erro visível, mesmo recolhido; nenhuma versão criada e nova tentativa explícita. Resposta da emissão perdida: revisão/token/chave e consentimento ficam no diálogo, e a repetição reutiliza a mesma requisição; não cria outra versão. Conflito real: não reproduz a escrita silenciosamente; mantém a confirmação/erro e exige atualização e novo consentimento. Continua sendo possível emitir N versões por decisões explícitas distintas, conforme contrato anterior.

## Layout, acessibilidade e limites

Uma faixa fixa inferior contém histórico/esquerda e emissão/direita. O resumo permanece disponível; o corpo expandido tem scroll próprio, com altura limitada em telas baixas. Valores mantêm todos os dígitos do formatador existente, sem arredondamento/abreviação novos. A reserva do Copiloto vale nas telas principais; nas telas internas sem o botão, esse espaço é liberado.

`--funix-safe-bottom` e `--funix-safe-right` usam `env(safe-area-inset-*)` por padrão. O teste substitui temporariamente essas variáveis CSS para simular 20 px inferiores/12 px à direita; não são opções de configuração do produto nem dados persistidos. A medida do rodapé controla apenas o balão aberto; a âncora do botão é puramente CSS e não muda ao recolher/expandir ou alternar abas.

Balão aberto fica acima do painel e sua ponta decorativa também respeita a separação. Em 320 px com financeiro expandido o conteúdo do balão pode exigir scroll, sem ocultar as ações financeiras; não há novas funções assistivas. Mobile emulado não substitui aparelho físico, safe-area nativa ou teclado virtual real.

## Testes reproduzíveis

```sh
npm run check
python -m unittest discover -s deploy/tests -v
python tests/browser/etapa5_rodape.py
python tests/browser/etapa5_regressions.py
```

Executar navegadores sequencialmente, com portas 5173/8787 livres. Apenas API real local e bancos SQLite temporários sintéticos. Regressões guardadas em `.runtime/etapa5/regressions`, ignorado pelo Git; capturas anteriores não são sobrescritas. O runner reexecuta integralmente as Etapas 2/3/4 e as dez suítes de regressão anteriores.

Testes dedicados: seis combinações aba/estado financeiro por dispositivo; âncora constante, histórico à esquerda/emissão à direita, Total fora da reserva, balão sem interseção com rodapé e sem overflow horizontal; safe-area simulada; histórico/versão/download PDF; erro HTTP de prévia recolhida; consentimento e prévia automática; resposta perdida + duplo clique com exatamente uma versão nova e mesma chave/token; conflito de revisão real, atualização explícita e novo consentimento; snapshot/PDF original imutáveis e SQLite íntegro/FKs.

## Resultados

**Rodada final aprovada:** build/TypeScript, **178 testes Node**, lint sem erros e quatro avisos preexistentes em App.tsx; **23 testes dos scripts de implantação**; **18 grupos dedicados + 172 grupos de regressão = 190 grupos de navegador**, com **33 screenshots** desktop/390/320. As 13 suítes de regressão incluem execução integral dos testes dedicados das Etapas 2, 3 e 4, sem alterar esses arquivos.

A emissão com resposta perdida repetiu token/chave/payload idênticos e gerou exatamente uma nova versão; conflito real não gerou emissão. Confirmados histórico/PDF, SQLite íntegro e ausência de chamadas externas. As 18 combinações aba/estado do financeiro mantiveram a âncora do botão; houve ensaio adicional de safe-area simulada em cada largura e separação do balão/navegação/rodapé. Logs finais, resultados estruturados e capturas em [evidencias/etapa5](evidencias/etapa5/).

Comparação com a base comprova **113 arquivos protegidos intactos**, incluindo backend/motor, migrações, catálogos, fila/hook/remoção, editor e estados, SVG e classificação radial e testes dedicados anteriores. O JSX interno do Mapa também permanece idêntico; as alterações do CommercialPanel são a moldura comum e a ligação do histórico/rodapé. Não houve nova CI remota ou homologação produtiva.

## Pendências para a Etapa 6 — não iniciada

1. Auditoria independente desta entrega e QA integrado final posteriormente autorizado.
2. Ergonomia em aparelho físico, teclado virtual e safe-area nativa; largura de 320 px continua exigindo atenção. Controles dentro do corpo financeiro e conteúdo do balão usam scroll quando necessário.
3. A02–A09/estado dos dados comerciais reais e instalação permanecem não verificados: não foi feita carga, inspeção de banco instalado ou escolha automática de fator/MR. Fixtures não comprovam carga produtiva.
4. CI remota não presumida: branch de integração sem PR, workflow existente de main/PRs. Não foi feito merge/deploy nem alteração de VPS/Coda/infraestrutura.

Parar para auditoria antes de iniciar a Etapa 6.
