# Issue #20 — regras comerciais e finalização FC/MR

Branch `feat/issue20-regras-comerciais`, PR #21 com base **main** após integração do PR #19 em `57090fe5139a36e42e9e3249aaf1f10f8fe880bc`. O diff contra main contém somente regras/carga/testes/documentação da Issue #20. Sem merge deste PR, deploy, alteração Coda/VPS/workflow ou execução no banco existente da aplicação.

## Fontes e precedência

Issue #20, confirmação de desconto `6487094880` e decisão da direção [6500884942](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/21#issuecomment-6500884942) prevalecem sobre trechos antigos do Coda/V0.9: FC condicional por serviço, FR obrigatório no normal, Desconto apenas elegível, quatro FV globais, MR único por Atendimento. Negociação conserva contrato distinto; especial exato e arredondamento V0.9 preservados.

A finalização reutiliza a exportação privada já coletada em `.runtime/issue20/export.json`: **15 tabelas/479 linhas** comerciais, sem registros de clientes. Não foi feita nova coleta nem escrita Coda nesta tarefa. Fonte bruta/preços/bancos/credenciais não são versionados. Os valores MR e as três decisões FC vêm da direção, não de uma modificação na exportação Coda.

## O que foi reaproveitado

Base por serviço + FD, FV/FC/FR, aritmética exata, especial triplo, energia por etapas/capacidade, cenários, negociação/resíduo, MR global, prévia/token/idempotência e snapshot/PDF imutáveis já existiam e foram preservados. A entrega inicial da Issue20 adicionou flags FC/descontável/faturável ao JSON V7/editor, limite de desconto e adaptação do importador ao FV simples. A finalização não altera novamente o motor ou o frontend.

## Alterações desta finalização

- `server/coda-import.ts`: decisões FC por IDs estáveis de Interna, Lavagem e Inspeção técnica: `colorFactorEnabled=false`. Nenhum serviço identificado somente por nome é alterado. As outras flags/FR não mudam. O relatório identifica a decisão da direção como origem.
- MR autorizado `Padrão`, fator `1.20` (representação decimal canônica `1.2`), ID técnico estável `funix:mr:padrao`. Adicionado somente ao plano de importação. MR equivalente já cadastrado é reutilizado com seu próprio ID; outras opções locais são preservadas. MR de mesmo nome/ID com valor divergente, renomeado ou duplicado é conflito: não sobrescreve nem aplica parcialmente.
- Não seleciona MR em Atendimentos existentes ou novos. Seleção explícita pelo operador continua necessária; nenhum PATCH automático de parâmetros.
- Testes do importador atualizados, quatro novos testes de decisões/integração e QA desktop/mobile que usa a opção importada, adiciona componente, confirma pendência sem MR, seleciona manualmente e verifica recarga/cálculo.
- Matriz, comparação com o commit anterior, dry-run e evidências atualizados. **Sem tabela, migração, dependência ou infraestrutura nova.** Sem nova camada de compatibilidade histórica. Nenhum banco existente foi recriado/apagado/modificado.

## Regras efetivas

| Assunto | Contrato |
|---|---|
| Normal | `teto_R$0,05(base × FD × FV × FC_efetivo × FR) × quantidade` |
| FC false | Efetivo 1; FC não selecionado não bloqueia. Os três serviços decididos pela direção entram assim no plano. |
| FC true / ausente legado | Exige FC; omissão legada conserva o contrato já aprovado. |
| FC null | Pendência explícita. **Na fonte ensaiada agora não restam FC pendentes.** |
| FR | Sempre obrigatório no normal, inclusive FV=0; nunca em componentes. |
| Especial | Chave exata Tabela+Serviço+Dimensão; ignora base/FD/FV/FC/FR, mantém teto e quantidade, energia técnica e elegibilidade de desconto. |
| Desconto | Limitado ao subtotal dos serviços com `discountable=true`; serviços protegidos/componentes mantêm preços integrais. Ausência da flag não concede desconto. |
| Negociação | Continua distinta do Desconto: ajuste do total de serviços, inclusive conciliação para baixo/aumento proporcional/resíduo. Total geral da UI usa `valueIncludesComponents:true`; componentes são deduzidos e preservados. |
| Faturável | Informativo e separado de Descontável; não exclui linha ou zera preço. |
| MR | Único por Atendimento, só componentes: `teto_R$0,05(manual × MR) × quantidade`. Padrão 1.2 significa R$100 → R$120 antes da quantidade. |
| Histórico | Configuração afeta rascunhos, não reescreve snapshots/PDF emitidos. |

## Dry-run e matriz reais

CLI em banco **V7 novo de QA**, apenas leitura, arquivo inalterado antes/depois: **zero conflitos**. Plano: 28 serviços, 75 dimensões, 16 diagnósticos; FC **12 ligados, 16 desligados, 0 pendentes**; uma opção MR Padrão 1.2; quatro tabelas com FV reais 1/0.8/0.6/0. Repetição ensaiada sem inserção/revisão extra.

Matriz de **300 combinações** (75 dimensões × quatro tabelas), quantidade 1, FC C0 e FR R0 reais, sem negociação/componentes: **204 calculáveis / 96 bloqueadas**. São **51 combinações serviço+dimensão** em quatro tabelas; inclui 51 casos de Retrabalho com FV=0. Calculável não significa receita positiva nem homologação geral.

Comparação sobre **a mesma exportação**, código anterior `36381387c1b85268d5c43485428de08b8847cfc2` vs finalização: **188 casos completos anteriores preservaram total, energia e prazo; 16 adicionais calculáveis; zero regressões ou valores alterados nos casos antes completos**. Novos casos: quatro dimensões de Lavagem nas quatro tabelas. Subconjunto Funilaria/Pintura/Montagem permanece **52/60**. A comparação anterior com PR19 (28 completos preservados no incremento de regras) permanece histórica; não deve ser confundida com a comparação desta finalização.

[Matriz por serviço/tabela](evidencias/issue20/MATRIZ.md) · [Todos os casos](evidencias/issue20/matriz.json) · [Comparação](evidencias/issue20/finalizacao/comparacao.json) · [Dry-run resumido](evidencias/issue20/finalizacao/dry-run-resumo.json).

MR é testado separadamente: sem seleção bloqueia componente; seleção manual Padrão transforma 100 em 120, mantém preço do serviço, aplica-se a mais de um componente e preserva quantidades fracionárias. A matriz de serviços não é evidência de todos os possíveis orçamentos com revenda.

## Pendências e conflitos

- Interna e Inspeção técnica já têm FC false, mas ainda não são calculáveis por outras pendências de preço/técnica. Não confundir FC resolvido com todas as relações resolvidas.
- Permanecem 24 dimensões com técnica/energia incompleta ou negativa na fonte; FD/base também faltam em alguns casos (como Encantamento/Inspeção técnica). Valores negativos não foram zerados nem compensados por suposição. Associação por IDs preservada; etapa parcial não é liberada.
- Mecânica não tem dimensão vinculada e é relatada fora das 300 combinações; cadastros terceirizados não são apagados ou inativados silenciosamente.
- Destino local divergente continua sendo conflito. Importador não substitui preços, flags, MR nem configurações locais. Uma configuração importada pelo commit anterior e depois alterada deve ser revisada explicitamente; esta tarefa não migra ou corrige automaticamente o banco existente.
- **Não implementado nesta tarefa:** lentidão/autosave/recargas e independência entre preço e energia. Sem novos recursos de aprovação, ERP, WhatsApp ou IA.

## Testes executados nesta finalização

- `npm run check`: build, tipos, **99 testes Node aprovados**, lint sem erros; quatro avisos React preexistentes. Inclui FR sem FC, FC apenas por IDs-alvo, desconto elegível, especial, energia, MR fracionário/global, ausência de seleção automática, reutilização/conflito local, dry-run/idempotência/rollback, snapshots/PDF.
- `tests/browser/issue18_import.py`, com saída em `docs/evidencias/issue20/finalizacao`: **6 grupos desktop/mobile aprovados**, API real/SQLite temporário com dados sintéticos, configuração/seletores/diagnóstico, MR aprovado cadastrado e não selecionado inicialmente, seleção manual e cálculo/recarga.
- Matriz completa e representativa executadas; comparação dos 300 casos com o código anterior; dry-run leitura; ensaio V7 novo com integridade/FKs/reinício/idempotência e configurações/snapshot/PDF existentes de QA intactos. Reutiliza o teste existente, sem acrescentar mecanismo de migração.
- Os 6 grupos `issue20_pricing` e 58 grupos de regressão da entrega inicial são **evidência histórica**, não reexecutados nesta finalização, que não altera UI/motor. Resultados anteriores permanecem identificados em `testes.json`; os resultados novos estão em `finalizacao/testes.json`.

## Reprodução local e limite de publicação

```bash
npm run check
# Exportação privada existente; destinos novos exclusivamente de QA:
node server/import-coda.ts --source FONTE_PRIVADA.json --database V7_QA_EXISTENTE.sqlite
node scripts/check-coda-import-cases.ts FONTE_PRIVADA.json MATRIZ_NOVA.json --all-services
node scripts/check-issue20-preservation.ts FONTE_PRIVADA.json BANCO_QA_NOVO.sqlite
```

O primeiro comando de importação é dry-run por padrão; não usar caminho do banco da aplicação. Para reproduzir o navegador com evidências separadas, ver [COMANDOS.md](evidencias/issue20/COMANDOS.md). Não foi executado importador no banco da aplicação, nem deploy, nem alteração produtiva. PR permanece aberto para auditoria; carga/publicação posterior exige autorização específica.
