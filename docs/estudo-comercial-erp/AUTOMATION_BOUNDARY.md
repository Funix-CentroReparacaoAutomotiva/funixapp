# FUNIX — fronteira entre comercial no app e operação no Coda

Data: 21/10/2026. Auditoria complementar somente em leitura. Proposta em análise: o app passa a ser dono de Atendimento, diagnóstico, composição/revisões de orçamento e agendamento; Coda recebe a Experiência operacional, cadastros estruturados e cópia do orçamento aprovado. Esta proposta é distinguida do comportamento produtivo descrito abaixo.

Nenhum workflow, webhook ou envio foi executado; não foram alterados app, ERP, Packs, credenciais ou integrações. Novas leituras: inventário n8n, grafos publicados dos quatro workflows, schemas/formatos dos botões Followup e PDF no Coda e metadados atuais de prontidão do ambiente. Os arquivos de auditoria Coda existentes foram consultados para as demais dependências de fórmulas; não foram lidos registros de clientes ou mensagens pessoais.

## Conclusão técnica

A separação comercial/app → operação/Coda é viável como evolução, mas o sistema atual não possui uma fronteira pronta de importação operacional. A entrada WhatsApp e a triagem ainda leem e escrevem `db_Atendimentos` no Coda. O follow-up comercial nasce em botão/Pack Coda, enquanto o n8n de envio é apenas transporte. A geração PDF já recebe um JSON independente do Coda e pode ser aproveitada por um adaptador backend, desde que snapshots e comandos tenham persistência e autorização próprias. Redis observado é cache/lock temporário; não há banco persistente do app verificado e configurado no runtime.

Não se deve ligar um novo criador de Atendimentos ou um novo executor de follow-up em paralelo com os existentes. A coexistência precisa identificar o sistema autor de cada registro/comando e encaminhar o evento a um único executor.

## Estado produtivo reconfirmado

| Processo | Workflow | Versão publicada | Diferença do draft |
|---|---|---|---|
| Classificar contatos WhatsApp | `21wpOido7t5OHb7i` | `e07fec83-208c-4643-b21c-7200beec0d84` | Sim; inclusive schedule de triagem ativo em produção e desabilitado no draft |
| Enviar mensagem | `22tutH8gEcX6bNoe` | `351ed7fe-3b60-426e-afc8-718dfe627172` | Sim |
| Preparar dados PDF | `EYGYfWf9rNeLsueT` | `c6738874-b9fe-42d7-bca4-1040fb84876d` | Sim |
| Gerar PDF | `vE1QlFYjOcjEoMZx` | `d87efefd-b4d1-43a4-82d1-381412ee9e39` | Não |

Os quatro continuam ativos e a busca não encontrou workflow adicional de importação de orçamento/Experiência para a nova fronteira. O último `updatedAt` retornado continua `2026-10-21T04:46:52.399Z`. Isso delimita a foto auditada; não substitui verificação antes de eventual implantação.

## Entrada WhatsApp: dependência forte do Coda comercial

No documento `2zsjI-nqWr`, o webhook de classificação:

1. Aceita `messages.upsert` de entrada, extrai ID de mensagem e instância, normaliza telefone/JID e produz `fx_UUID = evo:{instancia}:{messageId}`.
2. Consulta `db_Entidades` (`grid-l9d-WgpqtC`) para respeitar `Não gerar lead`.
3. Consulta `db_Atendimentos` (`grid-eGvJhrlDTH`) por `funil_contatoE164` e considera existência de atendimento aberto. O critério de encerramento usa nomes normalizados de status comerciais específicos; não consulta o banco do novo app.
4. Faz contenção Redis `funix:crm:criacao:{telefoneE164}` com TTL de 180s.
5. Cria linha Coda usando `fx_UUID` como key column. Escreve tipo, vaga, nome/contato, canal, status inicial, identificador do evento, JID e origem quando há retorno após encerramento.

Assim, um Atendimento aberto somente no app é invisível à deduplicação legada. Duplicar a entrega do mesmo evento para o app e o workflow atual pode criar dois registros comerciais. O lock Redis existente coordena o caminho atual; não fornece por si só unicidade transacional entre dois bancos. Usar telefone como única chave global também não representa o modelo aprovado N:N entre chats e Atendimentos.

### Triagem profissional publicada

A triagem agendada lê candidatos no Coda, exige tipo e status inicial Coda, agrupa por telefone e persiste seu journal na coluna `Triagem automática` (`c-709jttmf6R`). Revalida o registro Coda e a preferência da Entidade, consulta a Evolution e confirma a persistência Coda antes de enviar. Mantém proteções de janela, intervenção humana, reserva e resultado indeterminado.

Uma migração de Atendimento comercial para o app não pode simplesmente redirecionar o nó final de escrita: consultas, referências de linha/status, journal, reserva e reconciliação dependem do mesmo autor. É necessário escolher entre manter a triagem profissional legada no Coda como escopo separado ou portar seu contrato completo para o app. A decisão sobre inclusão de candidatos no domínio comercial do app é de produto/negócio; a auditoria não a presume.

## Follow-up: decisão no Coda, transporte no n8n

O botão `db_Atendimentos.add_Followup` (`c-4taGeBplgf`) depende do status comercial `c-xUxJ99lkfc`, do contato normalizado `c-5poWJk5IsH` e das três copies da tabela `db_CopyMensagemParaLead` (`grid-j9Iy2JjVsf`), selecionadas por relação com `cnf_StatusComercial` (`grid-DXriGyd94a`). A propriedade de botão consultada o desabilita quando há `at_programarRetomada` (`c-6K0uD4Qa0x`).

A leitura atual do schema/format confirmou que a ação ativa é `Funix - n8n` (Pack `71828`) `::SolicitarEnvio(E164.ToText(), List(Copy_1, Copy_2, Copy_3).Filter(IsNotBlank()))`. Não contém `ModifyRows` no trecho ativo. A integração Make.com (`29194`) e a progressão de status aparecem somente em bloco comentado. Portanto, as dependências textuais de Make/ordem/status do inventário bruto não provam execução atual, e não há base para reproduzir avanço automático de status como comportamento existente. A implementação interna do Pack não foi acessada; seu resultado e suas exceções não foram testados nesta investigação.

O workflow n8n de envio publicado recebe somente `telefone` e `mensagens[]`; não consulta status comercial, ID de Atendimento, data de retomada ou autorização comercial no Coda. Separa mensagens, envia uma por vez com intervalo de 1.500ms para `message/sendText` da instância Evolution `funix_comercial` e valida quantidade de recibos e `key.id/fromMe=true`.

Consequência: transporte e template comercial são contratos distintos. O app poderá reutilizar o transporte por backend, mas deverá carregar/validar a política de follow-up e ser o único dono dos comandos dos registros sob sua autoria. Eventual avanço automático de status é uma decisão funcional a validar, não uma regra atual comprovada por esse botão. Enviar pelo app e acionar o botão Coda para o mesmo caso não constitui um fluxo seguro. Também não se deve avançar status apenas por HTTP 200 do navegador ou tratar aceitação Evolution como entrega/leitura do destinatário.

Não foi encontrado identificador persistente de comando/idempotência no fluxo simples de envio. A repetição após timeout pode duplicar mensagens. O backend novo precisa de journal persistente por comando, estado de resultado incerto e recuperação/reconciliação antes de habilitar envio real. O workflow não deve receber uma credencial diretamente do navegador.

## PDF: contrato reutilizável, sem banco de snapshots no n8n

O botão Coda `db_Orcamentos.pdf_gerarOrcamento` (`c-iQtHw9hpKc`) monta JSON a partir de orçamento e filhos. A leitura atual do schema/format confirmou: `meta.id` vem de `ID_Orcamento` (`c-8dKWwlT8ZU`); `solicitacao` é `P` concatenado a dois `RandomInteger(100000000, 999999999)`; a ordem ativa é gravar `json` (`c-ECj9FWzkuU`), chamar `Funix - n8n` (Pack `71828`) `::PrepararPDF(jsonOrcamento, "producao", solicitacao)` e abrir a URL de geração com ID e solicitação. O segundo parâmetro do Pack é a seleção de ambiente, não a URL do webhook. Esse JSON é o último snapshot gravado na linha, sem evidência de histórico imutável de revisões nessa coluna.

O artefato auditado lista dependências de diagnósticos, itens, etapas/cluster, totais e condições de pagamento. A cópia operacional não pode restringir-se ao total ou ao PDF se OS e cálculos Coda precisarem dos filhos estruturados.

No n8n, **Preparar dados PDF** aceita `body.json`, `body.dados` ou o próprio body; recebe objeto ou texto JSON. Exige `meta.id`, `cliente`, `veiculo` e array `diagnosticos`. `solicitacao` é opcional nesse preparador, com formato `[A-Za-z0-9_-]` e tamanho 8–80 quando informado. Guarda JSON no Redis por 300s e responde `sucesso/id/chave`.

**Gerar PDF** usa `query.id` e `query.solicitacao` na chave Redis, confere `dados.meta.id` e chama jsreport `/api/report`, template `FUNIX - Orcamento`, devolvendo PDF. Não foi encontrada gravação de orçamento, filhos, arquivo permanente, revisão, aprovação ou comprovante nesse fluxo.

Recomendação de reutilização: o app salva primeiro sua revisão imutável e hash do orçamento em banco persistente; gera um ID seguro de solicitação; envia exatamente esse snapshot ao preparador; busca o PDF pelo mesmo par ID/solicitação; registra o resultado/arquivo de acordo com a política de retenção aprovada. O renderer não deve reler um orçamento mutável durante a geração. `meta.id` deve ter namespace/identidade estável para não colidir com orçamento legado.

Há assimetria entre preparador, que aceita ausência de `solicitacao`, e gerador, que concatena sempre esse campo. O adaptador novo deve sempre enviá-lo. O GET de geração não configura autenticação no grafo publicado; é necessário revisar controles efetivos e expor ao cliente apenas uma rota autorizada do backend. Nenhum controle externo ao grafo foi presumido ou testado.

## Onde a nova fronteira exige contrato ou roteamento

| Área | Comportamento existente | Tratamento proposto para coexistência |
|---|---|---|
| Recepção WhatsApp/lead | Evolution → classificação n8n → Atendimento Coda | Router/inbox único; casos legados continuam legados; casos novos do app são enviados a um único comando de ingestão persistente. Não duplicar webhook de negócio |
| Não gerar lead | Preferência em Entidades Coda | Manter Coda como fonte dessa preferência operacional até decisão explícita; usar leitura/cache controlado, com falha conservadora para automação |
| Triagem candidato | Coda + journal Coda + Redis + Evolution | Conservar como escopo legado separado inicialmente ou migrar contrato inteiro com journal e corte explícito; não portar só escrita |
| Envio manual/follow-up | Pack escolhe mensagens; n8n transporta | Um autor de comando e status por caso; compartilhar transporte somente através de backend/outbox com idempotência |
| Diagnósticos e revisão comercial | Coda tem tabelas e fórmulas atuais | App assume apenas os novos casos sob seu domínio; importar catálogos com versão e preservar a revisão usada. Legados continuam com IDs e autoria preservados |
| PDF comercial | Botão Coda constrói JSON; Redis temporário; jsreport renderiza | App cria snapshot persistente e reutiliza renderer por adaptação segura; Coda Pack continua atendendo orçamentos legados |
| Agendamento/handoff | Ação e relacionamentos Coda dependem de Atendimento Coda | Criar comando único de entrega operacional; avaliar registro de ponte Coda ou referências externas antes de retirar Atendimento Coda de novos casos |
| Orçamento aprovado operacional | Coda tem orçamento e filhos, Experiência/OS relacionados | Importar snapshot e filhos em lote rastreável, com mapeamento de IDs, totais, versão e confirmação. Não há workflow pronto para isso |
| Retorno/status operacional | Fórmulas e processos Coda | App recebe projeção operacional e não grava fase calculada. Definir dono por campo e evitar sincronização bidirecional genérica |

## Contrato mínimo de entrega operacional proposto

Isto é proposta para implementação e revisão, não endpoint existente. O comando de handoff precisa conter `handoffId` único, ID do Atendimento do app, revisão/hash do orçamento aprovado, identidade dos aprovadores e evidência/instante de aprovação, cliente/veículo/pagador e seus IDs Coda quando já existentes, datas e dados estruturados de diagnósticos/serviços/etapas/itens. Deve registrar correlação entre IDs de app e Coda sem usar telefone/placa como identidade suficiente.

O processador deve gravar um estado persistente por etapa (`pendente`, `em_processamento`, `entregue`, `requer_revisao`), impedir dois handoffs do mesmo agendamento e reconciliar timeout por IDs antes de repetir. A criação Coda é assíncrona e envolve várias tabelas, portanto não equivale a uma transação atômica. Só confirmar o agendamento integrado após readback coerente dos vínculos e totais; falha parcial deve ser visível e recuperável. Repetição de handoff não deve disparar novamente botões de geração, cópia de filhos ou criação de Experiência/OS.

A relação operacional com `db_Atendimentos` não pode ser removida só por convenção: a auditoria local registra `db_Experiencias.Atendimento`, `db_Orcamentos.ID_Atendimento` e processos que navegam por esses vínculos. Um registro mínimo de ponte pode preservar compatibilidade durante a transição; alternativa de trocar relacionamentos por IDs externos exige redesign e aprovação do ERP. Não criar os dois caminhos simultaneamente nem chamar o botão legado de agendar e o comando novo para o mesmo caso.

## Regras de coexistência recomendadas

1. Cada caso tem autor comercial explícito (`coda_legado` ou `app`), mantido em registro persistente de roteamento; cada comando tem ID único. Não resolver autoria inferindo apenas data, telefone ou existência de PDF.
2. Casos legados permanecem na execução atual até encerramento ou migração individual explícita. Seus IDs Coda e vínculos operacionais não são reescritos.
3. A entrada de novos casos usa um ponto único de deduplicação de eventos. Repetições Evolution utilizam instância/ID de mensagem, enquanto a associação de chat ao Atendimento é um vínculo separado e pode ser N:N.
4. O app comercial é o único escritor de seus rascunhos/revisões, follow-ups e agendamento. O Coda operacional continua autor de execução, OS, processos, finanças e suas fórmulas. Projeções/caches não viram segundo autor.
5. Após handoff, preservar a revisão aprovada entregue. Mudança comercial posterior cria nova revisão/solicitação de alteração com decisão explícita de impacto operacional; não sobrescrever silenciosamente o snapshot já entregue.
6. Roteamento/corte, novos campos de referência Coda, mudança de Packs/workflows produtivos, regras de aprovação e retenção precisam de revisão da direção. Implementar e testar primeiro com fixtures e ambiente isolado, incluindo timeout após gravação, duplicidade de evento, PDF expirado e falha parcial de entrega.

## Banco do app: capacidade observada e lacunas

O ambiente gerenciado retornou `observations_current=true`, rede `enforced`, `capabilities=[]`, `secrets=[]`, `runtime_variables=[]` e `outbound_identities=[]`. Isso confirma ausência de configuração de credencial/binding de banco no runtime consultado; não prova inexistência de servidores externos da FUNIX.

Nas integrações auditadas, Coda é o armazenamento persistente atual. Redis é utilizado com TTL de 180/600s para contenção e 300s para PDF; persistência AOF/RDB, política de eviction, backups, restauração, isolamento e credenciais de app não foram demonstrados. Não é base suficiente para adotá-lo como banco principal. A busca de Data Tables n8n anterior retornou zero; mesmo disponibilidade futura não validaria por si só transações, auditoria e recuperação do domínio comercial.

O pacote local consultado contém adaptador Coda de leitura e sessão de desenvolvimento em memória, sem driver/configuração de banco comercial persistente. Nenhum serviço já apto e configurado para ser o banco comercial foi verificado nesta auditoria. Recomenda-se selecionar/provisionar armazenamento persistente transacional e autenticação em decisão de arquitetura, com testes de backup/restauração e contratos definidos, sem migrar produção como efeito colateral do primeiro incremento.

## Limites e evidências

Fontes locais: `/workspace/work/automation-inventory.md`, `/workspace/work/coda-schema.json`, `/workspace/work/coda-processes.json`, `/workspace/work/coda-contract-manifest.json` e `/workspace/work/erp-full-audit/HANDOFF_SCHEMAS.json`. Novas leituras de grafos publicados confirmaram os IDs/versões acima e os contratos de nó; `table_columns_read(include=["formats"])` em `grid-eGvJhrlDTH` e `grid-LgsVNgYj3J` confirmou as ações ativas dos dois botões. As fórmulas completas com endpoints não foram copiadas para este relatório. Metadados de credenciais comprovam referências, não expõem valores e não autorizam automaticamente seu uso por um backend novo. Código-fonte/configuração interna do Pack 71828 e automações internas Coda não foram acessados por esta subauditoria; não há alegação de completude fora do escopo verificado.
