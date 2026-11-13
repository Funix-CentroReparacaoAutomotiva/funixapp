# Decisão de arquitetura — Chat e Atendimento no MVP com ERP vigente

Direção confirmada em 13/11/2026, America/Sao_Paulo. Este documento registra o escopo acordado; não declara a nova arquitetura implementada nem autoriza merge, deploy, alteração de workflows publicados ou dados reais. Complementa a investigação `IDENTIDADE_PN_LID_REVISAO.md` e delimita a implementação seguinte.

## Objetivo e limites

O FunixApp organiza as conversas e prepara sua operação independente; durante esta etapa o ERP/Coda continua responsável pelas decisões comerciais já executadas no fluxo existente. Retirar essa responsabilidade do ERP é uma etapa posterior, não um efeito colateral da implementação do Chat.

Sem novos perfis de operador, permissões granulares, solicitação de aprovação por ação ou cadastro geral de identidade de pessoas. Preservar login e autenticação entre sistemas existentes. A validação de vínculo e destinatário continua necessária para evitar mensagens no Atendimento errado; não é um novo sistema de permissões.

Implementação dentro do backend e SQLite existentes. Sem microserviços, broker novo, banco adicional ou espelho completo do ERP. Não criar fila/recibo paralelos se os existentes puderem cumprir o contrato.

## Responsabilidade de cada componente nesta etapa

| Componente | Responsabilidade | Limite |
| --- | --- | --- |
| Evolution | Transporte WhatsApp, eventos, envio e recuperação do histórico disponível | Não define Atendimento nem regras comerciais; dados do provedor passam por validação |
| FunixApp Chat | Identidade técnica da conversa, mensagens recebidas, consulta local, associação e envio validado | Não transforma nome/telefone em prova de identidade; não decide criar lead por receber mensagem |
| FunixApp Atendimento | Ficha local com UUID estável e referência ao registro canônico confirmado pelo ERP | Não concorre com o ERP na decisão comercial nesta etapa |
| ERP/Coda e fluxo comercial vigente | Decidir criação/reutilização do Atendimento pelas regras atuais e confirmar o ID real | Não precisa confirmar cada mensagem para que a conversa seja registrada |
| n8n | Transportar eventos, executar automações e integrar sistemas | Regras técnicas de identidade, deduplicação e envio do FunixApp ficam no backend |

O n8n mantém temporariamente as decisões comerciais que hoje executa em conjunto com o ERP. Essa exceção de transição é explícita; não exige reescrever o workflow produtivo junto com o núcleo de Chat.

## Modelo mínimo

- Conversa possui UUID interno estável; instância, PN e LID são referências técnicas externas verificadas. Não criar um cadastro de cliente completo apenas para resolver PN/LID.
- Conversa existe antes de haver Atendimento. Falta de confirmação comercial produz pendência de associação, sem inventar ficha e sem perder mensagens recebidas.
- Atendimento tem UUID local e referência Coda. Associação conversa–Atendimento e ficha selecionada na interface são conceitos distintos.
- Neste MVP, mostrar a conversa do contato no Atendimento confirmado, sem prometer partição histórica por serviço/período. Não atribuir retroativamente todas as mensagens a uma ficha apenas porque ela se tornou ativa. Atendimentos anteriores e contextos divergentes exigem regra explícita antes de ampliar sua navegação.
- Identidade ou associação contraditória bloqueia operações afetadas. Motivos distintos devem ser representados como ausência de vínculo, conflito ou falha temporária; não reduzir tudo a `null` sem diagnóstico.
- Todas as rotas de leitura, mídia e envio usam a mesma validação. Uma rota genérica não pode contornar a quarentena aplicada na rota do Atendimento.

Não manter três cadastros independentes de conversa como autoridades permanentes. A migração deve preservar IDs já usados e escolher um registro persistente comum, com compatibilidade explícita para o legado; não excluir tabelas/dados antigos automaticamente.

## Mensagens locais: necessário, mas incremental

A persistência local é recomendada para este MVP: desacopla mensagens já recebidas da disponibilidade de `findMessages` e da confirmação comercial do ERP. Escopo mínimo:

1. Receber evento, validar estrutura/origem e persistir antes de confirmar recebimento. Evento repetido deve produzir o mesmo efeito e recibo.
2. Registrar conversa e mensagem mesmo quando o vínculo comercial está pendente. Receber não autoriza mostrar o conteúdo dentro de qualquer Atendimento.
3. Guardar texto, identidade técnica, horários, tipo, observações de entrega e referências de mídia. Não armazenar binários de mídia nem snapshots privados desnecessários.
4. Tratar edições, conteúdo indisponível e atualizações fora de ordem, distinguindo atualização legítima de colisão de identidade. Conteúdo ausente não apaga texto anterior automaticamente sem semântica comprovada do evento.
5. Recuperar histórico Evolution sob demanda, com limites e informação de cobertura. Não importar todo o passado nem declarar histórico completo por sucesso de uma página.
6. Começar registrando os eventos sem mudar a leitura atual. Só mudar a leitura para o armazenamento local depois de validar correspondência e deduplicação. Durante a transição, uma única regra explícita determina a fonte da leitura; evitar concatenar silenciosamente duas listas de mensagens.

A integração precisa observar também mensagens enviadas pelo celular ou pelos fluxos externos existentes. `fromMe` não prova que o envio partiu do FunixApp.

## Integração ERP e envio: garantias mínimas

Confirmação comercial carrega ID Coda e referência causal do evento/decisão original. Repetição não cria outra ficha; evento antigo não substitui uma decisão mais recente. Contradição conhecida precisa permanecer registrada mesmo que a solicitação conflitante seja rejeitada.

Uma falha de sincronização fica pendente para repetição/revisão, sem apagar o que foi salvo e sem criar Atendimento por aproximação de telefone. Reaproveitar source ledger, decision ledger, outbox e recibos existentes onde seus contratos forem adequados. Não reexecutar workflow comercial inteiro para recuperar uma confirmação.

Envios iniciados no FunixApp usam um destinatário validado no backend e um identificador de operação estável. Registrar tentativa/resultado de forma durável permite reconhecer uma requisição repetida. Falha após início do envio pode significar resultado incerto: não repetir automaticamente no WhatsApp. A fila de eventos comerciais, que admite retry idempotente, não deve impor a mesma política ao envio de mensagens.

## Reaproveitamento verificado no código

- `server/chat/repository.ts`, `schema.ts` e `ingest.ts` já contêm mensagens locais, eventos, recibos transacionais e deduplicação. Isso é base disponível, não prova de recepção operacional habilitada.
- O contrato em `shared/chat.ts` contém upsert/status, mas não modela explicitamente edição/exclusão; o repositório põe conteúdo divergente do mesmo ID em conflito. Adaptar e testar antes de usar como histórico principal.
- O modelo local antigo atribui mensagens a períodos de vínculo; V20 e sincronização Coda têm outras regras. Não ativar esses modelos juntos sem definir a semântica comum.
- `coda-outbox-*`, source/decision ledger e reconciliação já oferecem componentes reaproveitáveis. Sua existência não comprova que o fluxo publicado os alimenta nem que estão habilitados no ambiente instalado.

## Sequência de implementação e aceitação

1. **Consistência da ponte atual:** corrigir os dois bloqueadores demonstrados na revisão — rota genérica contornando quarentena e contradição de timestamp descartada ao retornar 409. Cobrir com testes antes da correção.
2. **Contrato único de conversa e eventos:** consolidar identidade/associação, adaptar o armazenamento existente e provar eventos repetidos, editados, atrasados, sem vínculo e com PN/LID conflitantes. Tudo em bancos temporários.
3. **Recepção incremental e leitura local:** preparar integração de desenvolvimento sem alterar o webhook/workflow publicado; validar recibos, perda de resposta, reprocessamento, reinício e histórico por lista/Funil. Mudança da fonte de leitura somente depois de equivalência verificada.
4. **Recuperação ERP e envios:** tornar pendências consultáveis e reprocessáveis pelos componentes existentes; testar envio duplicado/resultado incerto sem mensagens reais.
5. **Homologação autorizada:** verificar A/B/C no celular, origem e cobertura do histórico e ausência de duplicidade. Implantação, replay real e alteração produtiva do n8n continuam sujeitos à autorização específica já exigida pela direção.

Pronto para o MVP significa uma conversa reconhecida de forma consistente, um vínculo explicado e recuperável, mensagens já recebidas consultáveis sem depender de nova consulta ao provedor e envio sem destinatário ambíguo. Não exige migrar agora todas as regras comerciais do ERP.
