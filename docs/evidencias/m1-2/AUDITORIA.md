# Roteiro para auditoria independente do M1.2

Base auditada: `3bf660eb5eb0500957a3f99552708d091a73b98b`. Publicação autorizada somente em `codex/m1-2-catalogos-diagnosticos`. O identificador completo do novo commit consta da entrega e do histórico Git desta branch. Nenhum código funcional foi alterado na preparação da publicação; apenas documentação foi atualizada para tornar as limitações explícitas.

## Pontos solicitados pela direção

| Ponto | Implementação/evidência | Limite a examinar |
|---|---|---|
| Integridade dos diagnósticos | `server/commercial.ts`, FK/migração 2, testes de referências, revisões e exclusão em cascata em `server/tests/commercial.test.ts` | Exclusão remove os serviços filhos; rascunhos aceitam diagnóstico/dimensão pendentes; não há emissão |
| Peças sem duplicações indevidas | Código físico único no catálogo e `UNIQUE(atendimento_id,piece_id)` na composição; teste Ambos e vistas repetidas; cenário de navegador | Deduplicação usa identidade física fornecida, sem inferir equivalências entre códigos diferentes |
| Múltiplos danos na mesma peça | Campo único `diagnosisId` por item; a mesma peça não cria segundo item | **Não existe suporte estruturado a múltiplos danos simultâneos por peça.** Trocar diagnóstico substitui a referência, preservando os serviços. Notas podem registrar texto, mas não constituem danos independentes. Não há teste demonstrando suporte inexistente; esta limitação exige parecer de adequação antes da continuidade |
| Inativação de catálogos | `active=false` preserva cadastro, histórico e referências; `usable()` impede novas seleções inativas; teste preserva/edita referências antigas a serviço e diagnóstico inativados | Não há invalidação em cascata dos rascunhos. Dimensão consulta a atividade do serviço pai em novas seleções; `saveCatalog()` também exige pai utilizável ao editar dimensão, inclusive para inativá-la. O teste atual não cobre todas as combinações de inativação de peça/dimensão/serviço pai |
| Quantidades fracionárias | `quantity` TEXT/string decimal, validação positiva, normalização sem conversão para float; arquivo reaberto preserva `"0.250000"` como `"0.25"`; navegador salva/reabre `"0.25"` | Até nove dígitos inteiros e seis casas decimais; sem notação exponencial. Não se testou motor monetário, pois não foi implementado |

## Evidências incluídas

- Relatório principal: `docs/M1_2_CATALOGOS_DIAGNOSTICOS.md`.
- Contratos: `docs/API.md`, `shared/commercial.ts`.
- Testes de migração/persistência/composição: `server/tests/commercial.test.ts`; fixture apenas DDL M1.1 e versão, sem linhas de clientes.
- Segurança/contrato HTTP: `server/tests/app.test.ts`.
- Cenários de navegador: `tests/browser/m1_2_catalogos.py`, `resultados.json`, capturas sintéticas e `browser-execucao.txt`.
- Regressão M1.1: `regressao-m1-1.txt` e subdiretório `regressao-m1-1/`.
- Comandos e resultados técnicos: `COMANDOS.md`, `npm-run-check.txt`, `deploy-tests.txt`, `container-build.txt`, `container-smoke.txt`.
- Arquivos incluídos: `ARQUIVOS.txt`. Conferência de publicação: `CONFERENCIA_PUBLICACAO.txt`.

As execuções funcionais já registradas são da entrega M1.2: 29 testes Node, sete grupos de navegador M1.2, 19 grupos de regressão M1.1, sete testes simulados de implantação e smoke local da imagem API. Nenhuma dessas evidências comprova suporte a múltiplos danos, implantação produtiva ou aprovação desta auditoria. Permanecem quatro avisos de lint preexistentes, sem erros.

Não foram incluídos bancos, credenciais, arquivos de ambiente reais, dependências instaladas ou informações reais de clientes nas alterações publicadas. Os registros e capturas de QA são sintéticos. O JSON estático V2 contém a referência de peças fornecida pela direção, sem carga de clientes.

A publicação não autoriza merge, deploy, escrita Coda ou M1.3.
