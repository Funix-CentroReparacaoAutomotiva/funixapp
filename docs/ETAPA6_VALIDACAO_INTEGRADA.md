# Issue #31 — Etapa 6/6: validação integrada final

Branch `feature/revisao-integrada-funix`, base aprovada `8f47a1c8dc661621fac00a7d35014858142119d6`. Escopo: auditoria funcional/visual das Etapas 2–5. Sem merge, deploy, importação, alterações comerciais, fórmulas, migrações, banco instalado ou infraestrutura.

## Resultado e alcance

A [matriz integral dos 72 requisitos](revisao-integrada/etapa6/MATRIZ_72.md) contém **62 aprovados no ambiente local sintético, um parcial (M04) e nove bloqueados por acesso ao destino (A01–A09)**. [JSON rastreável](revisao-integrada/etapa6/MATRIZ_72.json) preserva as colunas da matriz original, decisão vigente, módulos e evidências; [CSV](revisao-integrada/etapa6/MATRIZ_72.csv) permite revisão individual.

Isso não é aprovação de dados produtivos nem autorização de publicação. A instalação não foi inspecionada por SSH: nenhum canal administrativo/VPN/TCP estava configurado e o domínio do aplicativo não integra a lista de rede autorizada. Não foi contornada essa política. O app não foi considerado indisponível apenas por essa restrição.

## Catálogos reais — origem diferente de destino

Consulta efetiva somente de leitura pelo conector Superhuman Docs/Coda, usando metadados das tabelas originais, confirmou: 16 diagnósticos, 28 serviços, 76 relações de dimensão de serviços, 34 nomes de dimensões, quatro tabelas, três tipos de tinta, quatro riscos e um registro de capacidade. Também existem 56 regras de precificação, 113 relações serviço/etapa, 16 dimensões técnicas, 39 etapas e 11 registros de energia. Contagens não significam que todos estejam ativos, válidos ou calculáveis.

A [evidência sanitizada](evidencias/etapa6/origem-coda-readonly.json) não contém valores comerciais nem dados pessoais. Não houve exportação/carga/dry-run de origem real, escrita Coda ou alteração de parâmetros. Uma segunda leitura projetada, sem dados pessoais, confirmou preenchimento numérico positivo nos três fatores de cor, quatro fatores de risco e um registro de capacidade. As quatro tabelas estão ativas: três fatores positivos e um zero, sem valores negativos/ausentes nesses campos. Apenas agregados foram registrados; isso não comprova compatibilidade das regras, vínculos completos, FC por serviço, seleção de MR ou validade energética das 113 associações técnicas. Não foi feita auditoria completa linha a linha da origem. **A02–A09 permanecem bloqueados quanto ao SQLite efetivamente utilizado e à disponibilidade real na interface instalada.** Não se presume FC, FR, MR selecionado, energia válida ou importação concluída a partir de contagens na origem. Os testes de importador são exclusivamente sintéticos.

## Conferência funcional e visual

- **Presença e cenário:** lista/Mapa controlam presença global; editor/comparação controlam flags. Consentimento por conteúdo ou outro cenário, Cancelar sem requisição/mutação, remoção protegida por revisões e transação. Respostas perdidas exigem reconciliação; não há repetição cega.
- **Editor/estados:** toggles preenchidos/vazados, segunda linha única, cards tracejados, Voltar centralizado e bottom sheet com foco/teclado/Escape. Ack real elimina falso alerta; pendência bloqueia saída insegura; erro preserva formulário e oferece recuperação. Ausência/configuração/rascunho não viram zero nem Calculando indefinido.
- **Mapa:** comparação individual de 163 códigos/caminhos com referência congelada e IDs runtime; 23 pares exatos (15 por lado, oito por posição), não apenas 23 ações. Círculo em todos os níveis; 13 opções laterais diretas em dois anéis, sem colisões entre alvos medidos. Genéricos continuam distintos e sem códigos inventados. SVG com região/contagem/intensidade.
- **Financeiro/histórico:** três abas, painel aberto/recolhido, histórico à esquerda, emissão à direita, total antes da reserva do Copiloto, âncora constante e safe-area simulada. Emissão prepara token internamente, exige consentimento, conserva idempotência/revisões e recupera resposta perdida sem nova versão. Snapshot e hash PDF anteriores permanecem iguais.
- **Motor/SQLite:** regressões de FC condicional, FR obrigatório no normal, especial exato, desconto elegível, MR global, quantidades exatas, energia/prazo e arredondamento. Integridade/FKs dos arquivos temporários e reinício real do processo, sem tocar SQLite instalado.

As capturas foram inspecionadas visualmente, além das verificações de geometria: desktop mantém shell compacto centralizado; em 390/320 px ações e totais ficam visíveis, cards e controles não colidem. Em 320 px o radial de 13 entradas é denso e usa quebras de palavras; não se confunde a medição técnica dos alvos com conforto de leitura em aparelho físico.

## Defeitos, limitações e gravidade

| Identificador | Classificação | Evidência / consequência | Disposição |
| --- | --- | --- | --- |
| ACC-01 | Bloqueio de validação, alto para publicação com dados reais | Sem acesso à revisão/SQLite instalado; contagens Coda não comprovam carga | A01–A09 bloqueados; inspeção administrativa read-only autorizada ainda necessária |
| VAL-01 | Limitação de cobertura, baixa | M04: árvore real não precisa do pager interno; regra com 14 nós coberta por teste unitário e posição abaixo do círculo conferida no JSX/CSS, sem screenshot desse fallback em uso | Parcial, sem inventar peças/categorias apenas para forçar produção |
| VAL-02 | Limitação de homologação, média | Chromium mobile emulado e insets CSS simulados não equivalem a aparelho físico/teclado virtual/safe-area nativa | Conferência pelo proprietário após futura publicação autorizada |
| LINT-01 | Avisos preexistentes, baixa | Quatro avisos set-state-in-effect em App.tsx, sem erro de lint | Registrados; sem refatoração preventiva |

No ensaio inicial da jornada adicional, a fixture usou uma chave idempotente de 15 caracteres: o servidor recusou corretamente com HTTP 400 pelo mínimo contratual. A chave sintética foi corrigida no teste; uma asserção inicial também passou a comparar identidade/atributos persistidos, pois a projeção `enabled` deve mudar com a flag do cenário. Não houve defeito do aplicativo nessas duas tentativas de preparação do ensaio.

Não foi necessária alteração funcional para os fluxos efetivamente validados. Novos arquivos de teste/relatório não ampliam funcionalidades. Eventual falha do próprio ensaio deve ser identificada separadamente de defeito do aplicativo; os resultados finais e logs, não tentativas intermediárias, determinam os totais.

## Reprodução e evidências

```sh
npm run check
python -m unittest discover -s deploy/tests -v
python tests/browser/etapa6_regressions.py
python tests/browser/etapa6_integrated.py
```

Executar suítes de navegador sequencialmente com portas 5173/8787 livres. O runner reexecuta 14 suítes e guarda resultados novos em `.runtime/etapa6/regressions`, sem sobrescrever evidências anteriores. A jornada adicional integra troca de aba, flag por cenário, edição/ack/Voltar, inclusão pelo sheet, confirmação/remoção pelo Mapa, reinício e preservação de snapshot/PDF. Dados e bancos são exclusivamente temporários/sintéticos. Nenhum banco, arquivo de ambiente, credencial ou exportação privada integra esta entrega.

**Rodada final executada e aprovada:** `npm run check` (build/TypeScript, 178 testes Node, zero falhas, lint com quatro avisos preexistentes); 23 testes de scripts; 190 grupos das 14 suítes de regressão + nove grupos da jornada integrada = **199 grupos de navegador**. **30 screenshots** selecionados, desktop 1440 px, 390 px e 320 px. [Resumo estruturado](evidencias/etapa6/RESULTADOS.json).

Resultados estruturados, logs e capturas selecionadas estão em [evidencias/etapa6](evidencias/etapa6/). O resumo de execução discrimina grupos de navegador; grupos não equivalem a uma única asserção nem substituem a matriz requisito por requisito.

## CI e parada obrigatória

Abrir PR **draft** para `main`, que executa a validação remota existente. O resultado definitivo, SHA e URL do run serão registrados no PR e na Issue #31 após conclusão. Evidências locais não são apresentadas como CI remota.

O workflow foi inspecionado sem alteração: publicação condicionada à `main` fora de `pull_request`; deploy exige `workflow_dispatch`, ref `main` e `deploy=true`. PR draft não publica imagens nem implanta. Nenhum workflow de deploy será disparado nesta tarefa.

Antes de qualquer publicação: auditoria final desta entrega; verificação administrativa read-only de A01–A09 e decisão sobre a carga efetiva dos cadastros; ergonomia física permanece identificada como validação posterior. Não iniciar outra etapa ou fazer merge/deploy automaticamente.
