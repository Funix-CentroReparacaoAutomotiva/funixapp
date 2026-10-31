# Issue #31 — Etapa 2/6: persistência e semântica de seleção

Base `8a4eb8a4f5677b7f4e8384ecc17ebcd16a46544e`, branch única `feature/revisao-integrada-funix`. Implementa somente a Etapa 2 conforme a [auditoria 6539836714](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/31#issuecomment-6539836714). Sem início da Etapa 3, merge, deploy, Coda, VPS, importação, banco instalado ou alteração de fórmulas/configuração comercial.

## Contrato entregue

- **Mapa e lista/Adicionar peça em Diagnósticos:** presença global na composição mestre. Peça desabilitada no cenário continua selecionada nesses controles. Desselecionar remove a peça/serviços/componentes dos rascunhos de todos os cenários.
- **Editor e comparação:** habilitação por flags em cada cenário. Desabilitar conserva mestre, atributos, filhos e demais cenários. Rótulos e anúncios distinguem presença de habilitação.
- Inclusões reutilizam o POST/identidades existentes. Novas peças continuam habilitadas só no cenário ativo. Uma peça já presente não é recriada nem habilitada por uma nova intenção de presença.
- A remoção confirmada é destrutiva para os filhos daquele item nos rascunhos; selecionar novamente depois de sua efetiva exclusão cria um novo item vazio, sem restaurar filhos. Nenhum cadastro do catálogo é apagado, fundido ou renomeado.
- IDs e conteúdo dos itens restantes são preservados. Snapshots e PDFs emitidos permanecem imutáveis.

## Confirmação e concorrência

O diálogo compacto aparece antes de mudar a seleção/enfileirar a remoção quando a peça tem participação habilitada em outro cenário ou conteúdo configurado. Além de serviços/componentes, diagnóstico e anotação já preenchidos também são protegidos. A lista de posições usa os cenários reais, inclusive lacunas de numeração. Cancelar não envia GET/POST/PATCH/DELETE nem modifica flags, revisões ou seleção.

`shared/piece-removal.ts` calcula o contexto de revisão/consentimento sem cálculos financeiros. O contexto de consentimento contém apenas os alvos e sua participação; não é um token de autorização nem novo armazenamento. Permanece em memória no cliente.

O backend reaproveita `CommercialRepository`, transação SQLite e cascatas existentes. DELETE em lote aceita até dois itens e exige revisão da composição e o conjunto completo de IDs/revisões de cenários, além da revisão de cada peça. Revalida tudo antes de remover qualquer alvo. Isso cobre alterações de componentes/atributos, flags e criação/remoção de cenários, que a antiga revisão isolada da peça não cobria. O DELETE individual passa a exigir o mesmo guard. Clientes antigos sem guard recebem erro em vez de exclusão desprotegida.

Não foram adicionados tabelas, migrações, índices, importador, dependências ou serviços. A verificação dos cenários lê somente IDs/revisões, sem recarregar flags/calcular preços no DELETE.

## Fila e falhas

A fila serial existente foi adaptada, sem fila externa. Consolida a última intenção por código, mantém o efeito otimista somente após confirmação necessária e aplica confirmações do servidor em segundo plano. Lotes independentes podem ser consolidados; um par Ambos pendente não é repartido para completar outro lote. Alvos já presentes/ausentes não são recriados/excluídos desnecessariamente.

Em HTTP de erro, revisão conflitante, resposta perdida/ilegível ou GET posterior falho, preserva intenções e interrompe novas mutações até recuperação explícita. A recuperação primeiro lê o estado salvo. Ausência confirmada do alvo de uma remoção própria resolve a intenção sem novo DELETE. Se o código tiver sido recriado com outro ID, bloqueia a intenção antiga. Se conteúdo/participação relevante mudar, exige nova confirmação; cancelar nessa reconciliação conserva os dados atuais. A consulta de recuperação em si é uma leitura explicitamente solicitada, diferentemente do cancelamento inicial sem requisições.

O layout, a hierarquia V2, os caminhos e a geometria radial do Mapa não foram modificados. Esta etapa testa um par real já disponível; a conferência/canonização dos 23 pares e das 163 rotas continua na Etapa 4.

## Autosave e retorno

O autosave do editor, confirmações/revisões e reconciliação existentes foram preservados. Avisos normais de gravação ficam fora do fluxo visual, mantendo anúncio acessível; falhas e recuperação continuam visíveis. Rascunho incompleto ainda tem aviso/guard legítimos. A distinção ampliada de incompletude versus cálculo pertence à Etapa 3 e não foi antecipada.

Negociação efetivamente zero usa o mesmo normalizador aprovado `negotiationInput`, sem marcar o Atendimento como negociação não salva. Negociação não zero ou inválida continua protegida. Não há mudança de fórmula, modalidade ou persistência de negociação. Voltar após ack de formulário completo mantém o comportamento seguro existente; sair durante gravação ou com rascunho real continua protegido.

## Matriz P01–P15

| ID | Resultado nesta etapa | Evidência |
| --- | --- | --- |
| P01 | Preservado: autosave operacional, sem botão Salvar | Regressões do editor e navegador dedicado; save-state confirmado |
| P02 | Atendido para status normal: sem deslocamento/toast de seleção; anúncios acessíveis | Status medido 1×1 fora do fluxo; erros e aviso de incompleto preservados |
| P03 | Atendido no escopo: zero efetivo não cria falso dirty; retorno após ack não pede descarte | Teste unitário de negociação e retorno no navegador; rascunho/erro reais não foram neutralizados |
| P04 | Preservado: navegação/saída segura durante gravação | Regressões Etapa B/editor e guards existentes, sem remoção de proteções |
| P05 | Atendido: fila global serial, última intenção e consolidação; Ambos não repartido entre lotes | Testes rápidos/intercalados/ack antigo e teste explícito de lote Ambos |
| P06 | Atendido: presença global nos seletores; flags não determinam seleção | Caso mestre desabilitado e ainda selecionado na lista e no radial |
| P07 | Preservado: editor/comparação habilitam só o cenário | Testes de flags, filhos e cenários independentes |
| P08 | Atendido: botão global redundante removido do editor, sem ação substituta | Assert de ausência; remoção pelo seletor |
| P09 | Atendido: confirmação com números reais dos cenários | Diálogo com cenários 1 e 3, inclusive lacuna |
| P10 | Atendido: conteúdo configurado pede confirmação mesmo sem outro cenário | Unitários para filhos e cenário desabilitado; diagnóstico/anotação também protegidos pelo contexto |
| P11 | Atendido: cancelar inicialmente não altera nada nem envia requisição | Contador zero GET/POST/PATCH/DELETE e workspace/revisões idênticos |
| P12 | Atendido: guard global transacional e reconciliação sem replay | Conflitos de flags/componente/serviço/cenário criado ou removido; HTTP/origem/auth |
| P13 | Atendido: IDs dos restantes, unicidade e respostas incertas | POST perdido, DELETE perdido, recriação externa, reversões rápidas e Ambos atômico |
| P14 | Preservado: orçamento emitido e PDF imutáveis | Snapshot e bytes/hash após remoção, alteração concorrente e reinício |
| P15 | Atendido no escopo: presença compartilhada versus habilitação por cenário | ARIA/textos do seletor, editor/comparação e contagens; aparência do toggle fica para Etapa 3 |

A02–A09 continuam pendentes de verificação direta dos dados reais. Testes sintéticos não comprovam a carga comercial da instalação e não autorizam importação ou escolha automática de MR.

## Testes reproduzíveis

```sh
npm run check
python -m unittest discover -s deploy/tests -v
python tests/browser/etapa2_persistencia.py
python tests/browser/etapa2_regressions.py
```

Os navegadores executam sequencialmente, com portas 5173/8787 livres. O teste dedicado recusa portas ocupadas e usa somente SQLite temporário/dados sintéticos; não carrega exportação real nem acessa o banco padrão. Desktop 1440×1000 e mobile emulado 390×844/320×568. Artefatos de regressão ficam no diretório ignorado `.runtime/etapa2/regressions`, evitando reescrever evidências históricas.

Testes do backend incluem aplicação HTTP real pelo handler autenticado, persistência em arquivo/reabertura, integridade/FKs, rollback atômico e snapshot/PDF. O navegador dedicado também usa o servidor real local e confirma o arquivo SQLite por uma conexão independente após reinício.

O entrypoint `etapa_c_selection.py` encaminha para a nova semântica aprovada: não é mais correto esperar que desselecionar deixe o mestre apenas desabilitado. As verificações antigas de inclusão/respostas perdidas mantiveram suas garantias de IDs/unicidade, ajustando apenas o resultado de desseleção. Labels de acessibilidade foram atualizados nos testes afetados.

**Resultado final:** `npm run check` aprovado, incluindo build/TypeScript, **148 testes Node** e lint sem erros (quatro avisos preexistentes em App.tsx); **23 testes dos scripts**; **21 grupos dedicados + 121 de regressão = 142 grupos de navegador**, sem falhas. Há 12 screenshots desktop/mobile. A execução final foi sequencial e integral após os ajustes de contrato dos testes antigos. Os hashes dos arquivos protegidos confirmam motor, configuração, migrações, importador, SVG/CSS do Mapa e workflow intactos.

Não houve nova CI disparada: somente a branch de integração será atualizada, sem PR/merge; o workflow existente valida pushes na main e PRs. Os resultados acima são locais, sem equivalência com homologação produtiva.

Resultados finais, comandos e evidências: [evidencias/etapa2](evidencias/etapa2/). Avaliação em dispositivo físico e QA integrado final permanecem posteriores.

## Limites para a revisão

Sem novas regras de preço, alterações de parâmetros comerciais ou dados reais. Sem mudanças nos paths do SVG, layout circular, paginação/hierarquia, editor visual da Etapa 3 ou rodapé/Copiloto da Etapa 5. Não há undo/restauração automática de filhos excluídos conscientemente. Conflito real pode manter a interface bloqueada até recuperação ou descarte explícitos; não se prioriza velocidade sobre integridade.

Parar para auditoria da Etapa 2 antes de avançar para a Etapa 3. Branch integrada permanece separada da main, sem PR/merge/deploy independente por etapa.
