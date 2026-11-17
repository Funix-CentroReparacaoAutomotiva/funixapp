# Entidades, telefones e WhatsApp — implementação de desenvolvimento

Base final: `main` em `dd1186c896621e22218acbb25f6b6ae78ed2de83`. A implementação começou em `2d7b077` e foi reaplicada sobre a main atualizada; a V21 de datas/revisões de OS foi preservada e Contatos ficou na V22. Branch: `feat/entidades-contatos-whatsapp`.

## Diagnóstico e decisões

O cadastro existente já distingue `customer_records.kind=entity|contact|vehicle`. `entity_id` permite vários Contatos por Entidade; `atendimento_references` permite várias Entidades por Atendimento e reutilização entre Atendimentos. Não foi necessária outra tabela de pessoas nem outra associação N:N. Os nomes livres e telefones de fichas antigas permanecem como snapshots/referências parciais; não se convertem em pessoas por coincidência.

`conversation_id` é um handle técnico opaco. A propriedade e continuidade das mensagens continuam na instância e no número/canal. `ConversationIdentities` conserva apenas pares PN/LID com evidência exata e bloqueia contradições, inclusive surgidas em páginas posteriores. `v20_associations` continua sendo vínculo comercial explícito e separado do Contato → Entidade. Selecionar responsáveis não cria esses vínculos.

As lacunas eram cadastro isolado de pessoa/telefone, ausência de verificação de disponibilidade WhatsApp e dependência de contexto comercial para abrir/enviar em um Chat novo. A solução adiciona autorização **por Contato salvo e canal confirmado**, sem fingir um Atendimento ativo. Reutiliza `EvolutionReadPoc`, transporte HTTP, gateways de texto/mídia, `ConversationIdentities`, `SendOperations` e o próprio componente `EvolutionAtendimentoChat`. As rotas antigas de Atendimento mantêm seus controles; nenhuma delas aceita uma associação inferida por Entidade.

## Modelo e compatibilidade

V22 adiciona:

- `customer_records.phone_normalized`: derivação E.164 de números completos com `+` e DDI; índice não exclusivo para preservar duplicidades anteriores.
- Índice de Contatos por `entity_id`.
- `contact_channel_checks`: estado, número consultado, instância do provedor, horários, lease e handle da conversa. Sem resposta bruta, nome ou credencial do provedor.
- Registro idempotente de envios existente (`chat_send_operations`) também disponível quando o armazenamento local de mensagens está desabilitado; criação compatível com tabelas anteriores.

A migração não altera UUIDs, JSONs históricos, `entity_id`, `conversation_id`, referências, mensagens, PDFs, OS, diagnósticos ou vínculos. Apenas deriva a coluna de consulta; não resolve duplicidades. `customerInventory` produz contagens e IDs de revisão sem incluir nomes, números ou conteúdo de mensagens. O inventário desta entrega foi exclusivamente sintético. O inventário da instalação permanece pendente de autorização.

Cadastro novo com número completo já existente retorna conflito. Um Contato existente sem Entidade pode ser selecionado explicitamente. Contato pertencente a outra Entidade retorna `CONTACT_OWNER_CONFLICT`; esta entrega não implementa transferência silenciosa nem uma política de transferência. Duplicidades históricas continuam legíveis e bloqueiam a nova autorização de Chat. Número de Contato com canal associado não pode ser substituído: cadastrar outro número preserva o histórico anterior. Omissão de telefone na edição não apaga nem desassocia registros existentes.

## Evolution: contrato e limite da evidência

A documentação do repositório relata Evolution **2.3.7**, conforme [POC anterior](../WHATSAPP_EVOLUTION_READ_POC.md). Não houve acesso à VPS, ao banco instalado ou à Evolution nesta tarefa; não se afirma que o digest/build instalado foi confirmado novamente.

Contrato consultado no código público `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`:

- [chat.router.ts](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/routes/chat.router.ts): `POST /chat/whatsappNumbers/{instance}`, HTTP 200, corpo `{numbers:["DDI..."]}`. É o equivalente suportado a `checkIsWhatsApp`.
- [whatsapp.baileys.service.ts](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts): resultado com `number`, `jid`, `exists`, campos opcionais de nome/LID. O serviço usa cache e pode normalizar números de países específicos.

O adaptador exige exatamente uma resposta por número solicitado, booleano estrito e número correspondente. Só aceita JID PN **exatamente igual** ao telefone consultado. Número alternativo, grupo, LID isolado ou resultado contraditório fica em revisão. Não transforma campo `lid`, nomes ou fotos em evidência de identidade civil nem aceita a normalização aproximada do provedor. Pares PN/LID já confirmados pela infraestrutura existente podem recuperar a conversa correspondente; nova contradição revoga leitura e envio antes da resposta.

Consulta acontece depois do commit do cadastro. Não há consulta por tecla. Timeout de 5 segundos por consulta, resposta HTTP limitada, sem redirects, duas consultas simultâneas por cadastro, até 50 Contatos por Entidade e limite global de 60 tentativas/minuto por processo. Lease persistido evita consultas concorrentes repetidas ao mesmo Contato. Resultados positivos: 7 dias; negativos: 24 horas; conflito de resposta: 1 hora; indisponibilidade: 1 minuto. Em indisponibilidade, a rodada para após o lote atual; os demais números ficam pendentes. Revalidação ocorre ao salvar, por ação de verificar ou ao abrir o Chat. Falha não significa “sem WhatsApp”. Não há ingestão, sincronização nova ou job de fundo.

## Operação e segurança

Em Conversas, **Pessoas e telefones → Nova pessoa ou organização → adicionar números → salvar**. A ficha mostra disponibilidade e acesso ao Chat de cada número. Também é possível selecionar um telefone já cadastrado e ainda não atribuído. No Atendimento, **Nova pessoa com telefones** cadastra e seleciona a Entidade; as linhas de pessoas existentes oferecem todos os seus Contatos. Informações parciais e contatos avulsos anteriores continuam disponíveis.

A lista de Conversas apresenta o nome atual da Entidade ligada ao Contato, com selo de cadastro, sem pedir um segundo nome. Apelidos históricos são preservados na base; não prevalecem sobre a Entidade. Estados provisórios anteriores continuam legíveis quando não há associação. A ação principal pode abrir o Chat do Contato confirmado; a ação de detalhes mantém os vínculos comerciais explícitos.

Abrir/verificar um Contato não cria mensagem, Atendimento ou vínculo comercial. Sem histórico retornado, o Chat oferece composição explícita quando o envio já está habilitado no servidor. O histórico nunca é combinado por Entidade. Quando a leitura local já está habilitada e possui mensagens, ela continua sendo a fonte autoritativa, inclusive em indisponibilidade da Evolution; páginas e estados reutilizam o store existente. Sem conteúdo local, a consulta ao provedor é somente leitura e não importa mensagens, inicializa Atendimento ou ativa ingestão. A leitura marca somente as mensagens locais apresentadas. A recuperação/sincronização histórica explícita já existente no Atendimento permanece preservada.

Leitura e mídia revalidam Contato, revisão, instância, PN/LID, titularidade não ambígua e handle antes/depois da rede. Envio exige sessão, Origin, JSON limitado, confirmação explícita, token do contexto atual e requestId idempotente. O destinatário é resolvido no backend; não há número/JID vindo do navegador. Texto e mídia compartilham o ledger por PN com as rotas antigas. Resultado incerto não é reenviado automaticamente, inclusive após reinício. Flags existentes de leitura/envio/mídia permanecem inalteradas. Rascunhos e IDs das operações ficam somente na memória da interface por Contato; troca de número não transfere o texto. Troca/fechamento fica bloqueado durante envio. Fechar a ficha ou recarregar não é persistência durável de rascunho.

## Verificações

Resultados finais e evidências sintéticas serão registrados após a conclusão da suíte e do CI. As verificações incluem contratos HTTP, concorrência/idempotência, PN/LID, migração e Chromium 320/390/1440, além das regressões existentes.

## Procedimento de migração e recuperação — somente cópia DEV autorizada

1. Confirmar por escrito o arquivo de origem e a cópia autorizada de desenvolvimento. Não apontar scripts para banco instalado. Não copiar ambiente/segredos de produção; impedir tráfego para serviços reais.
2. Inventariar a cópia em modo somente leitura com `customerInventory`: duplicidades exatas, telefones incompletos, titulares inválidos e canais que precisam de revalidação. Não corrigir ou fundir automaticamente. Registrar `PRAGMA integrity_check`, `foreign_key_check` e sequência de `schema_migrations`.
3. Criar backup consistente com a API SQLite de backup existente, incluindo WAL, para outro caminho; verificar abertura e integridade do backup. Não usar `cp` de arquivo ativo com WAL. Registrar hash do backup e guardar a origem sem modificações.
4. Aplicar a migração pelo mecanismo normal **em outra cópia descartável**. V22 é atômica em `BEGIN IMMEDIATE`: falha de DDL/dados reverte schema e versão. Reabrir e executar migração novamente para verificar idempotência.
5. Comparar todas as colunas antigas/linhas com o backup usando `scripts/verify-v19-copy.ts BACKUP COPIA_MIGRADA`, compatível até V22. Confirmar UUIDs, referências, mensagens, vínculos, snapshots, PDF/OS e integridade referencial. A nova coluna normalizada é uma projeção, não uma fusão.
6. Em falha, parar a aplicação DEV. Preservar o arquivo com falha para investigação e restaurar o backup consistente **para novo arquivo**. Verificar schema antigo e conteúdo antes de abrir com revisão compatível. Não executar down-migration destrutiva nem substituir banco que recebeu trabalho novo; reconciliar esse trabalho separadamente.

O teste `entity-migration.test.ts` executa backup real SQLite em arquivo sintético, falha provocada, rollback transacional, reaplicação, comparação, reinício e restauração separada. Nenhum passo acima foi executado em dados instalados.

## Homologação externa pendente

- Autorizar separadamente ambiente DEV conectado à Evolution e números controlados; confirmar versão/build e contrato real de `whatsappNumbers` sem envio. Exercitar positivo, negativo, timeout e LID/normalização divergente. Não flexibilizar correspondência por tentativa.
- Validar dois números controlados da mesma pessoa: dois Chats e históricos separados; Entidade renomeada aparece em ambos, sem mover mensagens. Confirmar coexistência com contatos históricos já associados.
- Envio real exige autorização específica adicional e confirmação do operador. Validar texto, imagem/áudio/vídeo, recibo, indisponibilidade e troca de contexto com números controlados. Não habilitar ingestão adicional para concluir este roteiro.
- Aparelhos físicos: 320/390, teclado, foco, rolagem, retorno, seleção de responsáveis, alternância de Contatos, preservação de rascunhos, cancelamento da confirmação e recuperação de falha. Chromium automatizado não substitui aparelhos reais.
- Volume maior e duplicidades da instalação exigem inventário autorizado. Não executar migração real, merge ou deploy a partir desta PR de desenvolvimento.
