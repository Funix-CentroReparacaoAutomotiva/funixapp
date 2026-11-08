# FUNIX — Evento WhatsApp → Atendimento → Chat real

**Status:** desenho técnico e critérios de aceite, não implementado nem autorizado em produção. Analisado em 08/11/2026 após esclarecimento explícito da direção. **Não é** autorização para alterar n8n, Coda, Evolution, WhatsApp, webhook, banco ou flags de runtime.

## Regra operacional confirmada

O **gatilho é a primeira mensagem recebida**, jamais o clique na conversa. Assim que o contato chega, o sistema deve encontrar o Atendimento correto ou criar um novo conforme as regras comerciais atuais. Selecionar a conversa deve abrir **o Atendimento já existente**, diretamente na aba Chat, com **o histórico verdadeiro da Evolution**. Diagnósticos e Mapa usam o mesmo Atendimento.

A premissa "todo contato tem Atendimento" é **objetivo de comportamento**, não garantia atual de cobertura. Falhas de integração, identidades não identificadas, exceções explícitas e latência devem aparecer como pendências de processamento, e não induzir criação silenciosa no clique.

## Fontes verificadas

- Workflow ativo de n8n `FUNIX | WhatsApp | Classificar contatos | PROD` (ID `21wpOido7t5OHb7i`), versão publicada consultada em modo somente leitura: recebe `messages.upsert`, considera apenas mensagens recebidas, seleciona telefone PN, consulta Funil no Coda, distingue Atendimento aberto/encerrado, usa `fx_UUID` e trava Redis, respeita bloqueio "Não gerar lead" e cria a linha do Funil no Coda.
- `server/atendimentos.ts`: o FunixApp mantém **Atendimentos locais em SQLite**, distintos dos cartões do Coda; a criação exige `phone` com dígito e inicializa configurações financeiras.
- `server/chat/v20-associations.ts`: vínculo N:N por conversa e Atendimento local, fechado por flag em produção, idempotente por requestId, mas não conhece identidade Coda.
- `server/chat/evolution-bridge.ts`: a leitura atual é independente dos Atendimentos; históricos são consultados na Evolution por JID e não são injetados automaticamente no `ChatPanel` do Atendimento.
- Amostra do piloto real: conversas `@lid` sem telefone PN confiável. O n8n atual retorna sem criar cartão quando não encontra JID PN. **Não associar LID a PN por suposição**.

## Responsabilidade e sequência proposta

1. **n8n/Coda continuam donos do gatilho e da decisão comercial de criar** (incluindo exceções e status do atendimento). Não criar segundo classificador paralelo no FunixApp.
2. Uma vez **confirmada a linha canônica Coda**, encaminhar a um adaptador de sincronização FUNIX um evento técnico autorizado contendo identificador **imutável da linha Coda**, chave idempotente do evento, instância e identificador técnico validado da conversa, e campos comerciais mínimos devidamente autorizados. Não encaminhar chave da Evolution ou conteúdo bruto de mensagens ao navegador.
3. Persistir mapeamento **único por origem+ID Coda** → UUID do Atendimento local. Eventos repetidos retornam o mesmo resultado, incluindo corridas concorrentes. Uma conversa pode ter diversos Atendimentos no tempo, e vários JIDs legitimamente verificados podem apontar para o mesmo Atendimento. Não inferir essa equivalência por nome/telefone parecido.
4. Não criar Atendimento local no clique nem em toda mensagem. Atualização de dados comerciais fica vinculada a versão/origem do registro canônico e não pode sobrescrever edição local mais recente sem política explícita de conflitos.
5. Depois da confirmação da sincronização, vincular conversa e Atendimento com a mesma semântica transacional e recibo; não publicar um estado de "pronto" antes de registrar a relação.
6. Ao abrir conversa, resolver o **Atendimento ativo selecionado por critério comercial verificável** e navegar para `/atendimentos/:id?aba=chat` com leitura do histórico Evolution, sem trocar para o `ChatPanel` legado. Se houver mais de um Atendimento ativo elegível, não escolher silenciosamente; deve-se decidir a regra de desempate.
7. Reprocessamento seguro (sem envios ao cliente) para pendências, falhas de Coda, atraso de evento e histórico pré-existente; no reprocessamento, aplicar os mesmos limites de idempotência e auditoria.

## Exceções que não podem ser ocultadas

- **Contato LID sem PN:** não inventar telefone e não associar identidade de outra pessoa. Avaliar contrato de Atendimento provisório com identidade técnica e vínculo controlado, mantendo regra de negócio; requer mudança de esquema/contrato e aceitação específica.
- **"Não gerar lead" / candidatos / contatos internos:** respeitar as exceções do workflow atual; registrar decisão operacional sem criação enganosa.
- **Retorno após encerramento:** o n8n hoje pode criar outro cartão; preservar histórico/vínculos anteriores e decisão correta de novo Atendimento.
- **Atendimento existente no Coda mas ausente no SQLite:** sincronizar pelo identificador Coda, não pela semelhança do nome, placa ou telefone.
- **Falha transitória:** recibo e reexecução segura, fila de pendência visível, nenhum cadastro novo no ato do clique e nenhuma duplicidade na repetição.
- **Histórico da Evolution:** leitura apenas; eventual página com metadados opcionais de mídia inválidos não deve bloquear todas as mensagens, mas identidade, conteúdo, instante e direção continuam estritamente verificados.

## Gates objetivos antes de ativar

- Contrato Coda→FunixApp aprovado: campos, minimização de dados, autenticação HMAC ou equivalente, replay, autorização, janela temporal, rate limit, respostas/retries.
- Identificador canônico Coda e regra de conflito da edição/atualização demonstrados em SQLite e testes.
- Repetição e concorrência: um evento 20 vezes, dois eventos do mesmo contato, Coda indisponível, falha após criar/antes de vincular, retorno após encerramento, 1:N e N:N.
- Segurança: PN/LID incompatíveis nunca se fundem, JID não é exposto ao navegador; preservação de "Não gerar lead" e exceções.
- Navegação: 320/390/1440 px, seleciona chat e abre Atendimento já provisionado; Chat é Evolution real e Diagnósticos/Mapa pertencem ao mesmo registro.
- Sem envio pelo FunixApp, sem novo webhook na Evolution, sem alteração do fluxo ativo até autorização por etapa, com backup, rollback e observabilidade definidos.
- CI completo, Chromium sintético e prova end-to-end em ambiente não produtivo antes da implantação. Só então validar produção com aprovação específica.

## Situação de execução

A PR #101 contém um **incremento parcial de correção de leitura** (duplicatas de status/ID de provedor e metadados opcionais de mídia) e UX de seleção imediata no Chat. Isso **não executa** a criação automática de Atendimento na primeira mensagem nem a sincronização Coda→SQLite. As abas Diagnósticos/Mapa só podem abrir registro associado explicitamente. Não considerar a experiência final entregue só por passar no CI dessa PR.
