# Funil, Conversas e Atendimento autônomos

## Auditoria anterior à implementação

Base: main 8ce4005166cd76a37d6cb955961578a755d06a52, checkout limpo. Referências: HTML V7 integral (428 linhas), V10 integral e prompt anexo. A solicitação do usuário prevalece sobre instruções históricas e interações demonstrativas dos HTMLs. Não reproduzir seus simuladores de mensagens, preços ou mapa.

- Implementado: Atendimento SQLite com UUID/revisão, anos independentes; composição mestre, cenários, cálculo racional no backend, orçamento imutável e Mapa. Autenticação/cookie e validação de origem nas rotas; relay HMAC, allowlist e corpo limitado.
- Implementado: identidade PN/LID com evidência exata, colisões em quarentena, mensagens locais deduplicadas, paginação keyset, edição/exclusão/status, envio com recibo e estado incerto sem retry cego.
- Parcial: três contratos coexistem: chat_links temporal (V14), v20_conversations/associations experimental N:N e chat_provider_conversations canônico. ChatBridge usa associação Coda para autorizar, e runtime exige Coda mesmo com armazenamento local. Isso impede produto autônomo.
- Ausente: criação comercial por inbound, snapshot/proveniência inicial, Contato/apelido independente, Entidade local, participantes e veículos múltiplos. Formulário exige telefone. Funil não deriva valores nem relógio de contato; Conversas não apresenta prévia/contadores/nomes V10.
- Riscos: substituir todo o Chat perderia proteções de identidade; usar telefone textual como vínculo vazaria históricos; usar updated_at como contato alteraria urgência ao editar placa; somar cenários inflaria potencial. Não converter nomes em entidades nem deduzir titularidade civil.

## Proposta

Migração aditiva versionada V18: registrar domínio comercial local e registro único de inicialização por conversa; preservar tabelas e snapshots antigos. Identidade técnica existente continua autoridade PN/LID. Associação N:N local reutiliza o contrato experimental, sem mover mensagens. Adapter local implementa o contrato de autorização já consumido pelo bridge, mantendo revalidação antes/depois de rede. Runtime local passa a operar sem Coda. Compatibilidade: gates anteriores continuam disponíveis, nenhuma integração legada nova.

O primeiro inbound upsert elegível executa mensagem, decisão comercial e snapshot na mesma transação SQLite IMMEDIATE. Reutiliza somente vínculo ativo explícito e único; zero vínculos cria uma ficha; múltiplos ativos não escolhe; somente encerrados não reabre. Recibo comercial impede que mensagens posteriores criem fichas após encerramento. LID sozinho permite ficha pendente sem telefone; conflito de identidade preserva a quarentena existente. Nenhum envio automático.

Reutilizar motor financeiro para faixa entre cenários, sem alterar fórmulas. Contato/apelido, nome do canal e referência comercial permanecem separados. Estado reconhecido indica registro selecionado, nunca identidade civil comprovada. Edição de telefone não altera vínculos nem mensagens.

## Validação prevista

Fixtures e bancos temporários: primeiro inbound, repetição, concorrência, reinício, reutilização, snapshot estático, encerrados, ambiguidade, PN/LID e N:N; nomes e selos; faixa comercial e relógio; autenticação/rotas e regressões existentes. Build, TypeScript servidor, lint, suíte servidor e navegação em 320/390/1440. Registrar somente execuções reais ao fim.

## Decisões implementadas

- Identidade técnica continua em `chat_provider_conversations` + evidências PN/LID. As tabelas N:N existentes passam a ser uma projeção comercial local dessa identidade, registradas pela V18; não há nova fila, banco ou transporte. `chat_links` e `chat_messages.link_id` históricos não são reatribuídos. A migração promove vínculos temporais ativos e relacionamentos confirmados já guardados no armazenamento local, com trilha de origem.
- `customer_records` distingue Entidade, Contato e Veículo; `atendimento_references` permite linhas livres ou referências explícitas para Pessoas, Contatos, Veículos e Pagadores. Nome de canal fica em cobertura, apelido do Contato em `nickname`, nome comercial na ficha/referência. Seleção de Contato conhecido associa explicitamente seu canal; igualdade textual de telefone não associa.
- `conversation_initialization` é o recibo único de decisão e snapshot inicial. A transação IMMEDIATE inclui mensagem, ficha, origem e vínculo. Retries, reinício e processos independentes não duplicam. Associação ativa única reutiliza ficha sem reescrever seus dados; múltiplas ativas ficam pendentes; somente encerradas não reabrem nem geram outra ficha por nova mensagem. Um novo ciclo comercial continua uma decisão manual.
- LID sem PN cria ficha parcial e guarda o contato técnico sem telefone inventado. Evidência posterior não repopula a ficha. Colisões de identidade retêm mensagem isolada e bloqueiam histórico/envio até resolução. PN/LID previamente independentes mantêm seus processos: evidência exata permite selecionar contexto e ler o histórico contínuo, sem terceira ficha ou fusão comercial.
- `closed_at` separa encerramento da etapa. A lane Encerrados inclui encerramentos explícitos e Rejeitados históricos; recusa ainda exige confirmação e motivo. Reabrir é ação manual explícita; mensagens nunca fazem isso.
- Relógio usa `atendimento_contact_events`, com inbound efetivo e envio aceito pelo provedor. Retries de envio não repetem o contato. Edição de ficha/registro não altera esse relógio. Sem evento conhecido, o card mostra relógio com interrogação. As faixas de urgência são 24/72/120 horas; não movem etapas automaticamente.
- Faixa comercial usa o motor racional vigente e a prévia oficial para negociações salvas. Cenários alternativos não são somados. Sem composição atual calculável, há fallback para a última emissão de cada cenário; versões históricas não se somam. Cenário atual incompleto resulta em valor desconhecido, sem recuperar preço antigo como se fosse atual. PDFs/snapshots existentes permanecem imutáveis.
- Lista V10: apelido explícito > pessoas distintas das referências comerciais > Sem nome; selos por associação explícita a Entidade. Telefone e prévia separados, nomes em uma linha, detalhes completos, contagem de vínculos e não lidas por mensagem recebida efetivamente retornada ao navegador. Projeções de participantes/contadores são consultadas em lote; verificações técnicas de identidade permanecem indexadas por canal.
- Troca de contexto usa a associação explícita e uma época monotônica. A→B→A invalida comandos antigos. A seleção não reatribui mensagens nem reinicia o histórico; cursores emitidos para contexto antigo são recusados. Rotas de leitura, mídia e envio revalidam a autoridade local existente no mesmo bridge.
- Preparar conversa manual usa somente um contato salvo, revisão da ficha e telefone completo com `+`/DDI. Não envia mensagem. Um histórico existente exige associação explícita, nunca é adotado porque o vendedor digitou um telefone igual. LID conhecido permite leitura/contexto; envio continua exigindo PN confiável. O composer pede confirmação antes de chamar o remetente.
- Fotos passam por gateway backend com cache positivo/negativo, limites de tamanho/concorrência/consultas e download restrito a hosts WhatsApp permitidos. Sem chave ou URL do provedor no navegador. Privacidade, recurso ausente, formato/host não permitido ou saturação retornam avatar de fallback.
- Navegação principal: Funil/Conversas, inferior no mobile e lateral no desktop. Configurações/Atualizações continuam acessíveis como ações secundárias. Atendimento mantém somente Chat/Diagnóstico/Mapa e edição pelo cabeçalho; componentes comerciais/Mapa existentes foram reutilizados.

## Contratos e ativação de desenvolvimento

- `POST /api/atendimentos`: criação progressiva, inclusive `{}`; `references` tipadas e validadas. `PATCH` conserva revisão otimista e campos livres. `closed` é booleano; o servidor determina a data.
- `/api/customer-records`: busca limitada por tipo, criação explícita e edição com revisão; selecionar entidade/veículo não cria cadastro por nome. Telefone de Contato com histórico fica protegido. Os campos primários derivados de referências são resolvidos no backend, inclusive em novas prévias de orçamento.
- `/api/chat/conversations/:id/atendimentos` e `/context`: contrato N:N reaproveitado, com escopo PN/LID exato validado no servidor. `/api/atendimentos/:id/conversations` oferece contatos explicitamente associados. `/prepare-conversation` exige revisão e índice de contato salvo, não aceita destinatário/JID do navegador.
- O runtime local funciona sem Coda. Em checkout com configuração legada ainda fornecida, `FUNIX_CHAT_AUTONOMOUS_ENABLED=true` seleciona a autoridade local; sem autoridade legada, a local já é escolhida. Armazenamento/leitura usam `FUNIX_CHAT_LOCAL_ENABLED=true` e `FUNIX_CHAT_LOCAL_READ_ENABLED=true`. Leitura do canal e ingestão autenticada conservam seus opt-ins existentes. Envio e mídia continuam OFF por padrão, com gates separados.
- Nenhuma flag instalada, segredo, webhook real ou configuração de canal foi alterada. Não ativar chaves reais para repetir os ensaios. Os scripts novos usam somente mocks e SQLite sintético.
- Ajustes nos importadores existentes limitam-se à aceitação do schema aditivo V18, necessária às regressões de catálogo/recomendações. Não há nova integração, carga, migração operacional ou chamada a sistema antigo.

## Compatibilidade e riscos de homologação

V18 é transacional e aditiva. O binário antigo recusa banco mais novo: rollback de binário exige backup compatível anterior; não remover tabelas para descartar dados novos. O helper de downgrade em `server/tests/fixtures/pre-v18.ts` existe exclusivamente para fixtures sintéticas, nunca para operação.

Handles históricos inconsistentes entre o experimento N:N e a identidade canônica devem ficar pendentes com erro de contexto, sem reatribuir IDs ou mensagens. A revisão operacional deve confirmar esses casos antes de ativar o modo autônomo em um banco instalado. Alias contraditório não é resolvido por aproximação, nome, foto ou edição de telefone.

A versão/capacidade instalada da Evolution, as permissões de foto e o roteamento real do relay não foram consultados ou alterados. A homologação posterior deve usar um número controlado e autorização própria para eventos/envios reais. O gateway pode mostrar fallback quando o provedor usa um host/formato não permitido; ampliar a allowlist exige evidência do contrato instalado.

A aplicação conserva o modelo atual de operador único autenticado; não foi introduzido RBAC ou cadastro de funcionários. Não há regra automática de novo ciclo após encerramento.

## Complementação de compatibilidade

A V18 também conserva vínculos já confirmados que estejam guardados no **SQLite do próprio FunixApp** pelo adaptador anterior. São copiados apenas relacionamentos técnicos explícitos; nomes/telefones não são usados para deduzir associações. Conflitos comerciais pendentes são conservados em `chat_local_context_holds`, bloqueando criação/reutilização e envio até seleção explícita de contexto. Não há consulta ou escrita em Coda, n8n ou qualquer sistema antigo. Se um conflito entre handles impedir a migração, ela falha atomicamente e conserva o banco anterior para revisão.

No modo autônomo explícito, o bootstrap ignora os opt-ins antigos de sincronização e não inicia o reconciliador anterior; o endpoint antigo de criação comercial fica indisponível. Isso evita duas autoridades criando fichas simultaneamente. O adaptador anterior permanece disponível no modo de compatibilidade, com seus testes preservados.

Novos eventos autenticados V1 de conversas individuais são adaptados para o mesmo armazenamento/política local, com namespace determinístico de recibo. Recibos V1 anteriores à mudança retornam pelo caminho original, sem reprocessamento ou criação retroativa. V2 e webhook Evolution continuam usando a normalização existente.

Atualizar outra linha da ficha preserva marca/modelo/descrição e anos legados do veículo. A representação livre de marca/modelo só substitui esses campos quando o veículo é efetivamente editado ou uma referência existente é selecionada.

## Base final e verificações executadas

A base passou de `8ce4005` para `2692b0e` por rebase da branch de desenvolvimento, preservando a pesquisa de peças já incorporada pela PR #218. Não foi realizado merge na main. A regressão Chromium de diagnóstico/orçamento foi repetida nessa base.

| Verificação | Resultado |
|---|---|
| `npm run build` (TypeScript frontend + Vite) | Passou; há aviso de chunk acima de 500 kB |
| `npm run check:server` | Passou |
| `npm run test:server` | 981 testes passaram, zero falhas |
| `npm run lint` | Retornou 0; conserva warnings de lint, inclusive avisos de estado em effects |
| `npm run test:voice-cost` | 8 testes passaram |
| `git diff --check` | Passou |
| `node scripts/customer-experience-browser.mjs` | 320/390/1440: nomes/selos, 20 nomes completos, contagem/não lidas, terceiro Maria/Pedro, confirmação cancelada/aceita com remetente mock, edição reconhecida, cadastro parcial, navegação, contexto N:N e ausência de overflow |
| `node scripts/atendimento-vehicle-browser.mjs` | 320/390/1440: campos livres, dois anos, autosave, telefone nas três abas, negociação salva e recarga |
| `node scripts/diagnosis-quote-browser.mjs` | 320/390/1440: composição/cotação/orçamento e seletor pesquisável da base atual |
| `python3 tests/browser/chat_v20_conversations.py` | 320/390/1440: polling, mídia sintética, envio explícito e revogação de contexto |
| `python3 tests/browser/chat_mvp_local.py` | 320/390/1440: histórico local, paginação de 125 mensagens, edição/exclusão e recibo de envio com ACK perdido |
| `python3 tests/browser/chat_v20_links.py` | 320/390/1440: N:N, conflito 409, seleção e desvínculo confirmado, gate OFF |
| `python3 tests/browser/chat_local_base.py` | 320/390/1440: regressões do Chat legado/autenticado e navegação |

`npm run check` agrega build, TypeScript servidor, suíte servidor, lint e custo/voz. As contagens acima se referem às execuções locais; CI remoto deve ser conferido no commit da PR. Os testes incluem seis processos SQLite concorrentes, reinício, rollback V18, HMAC inválido/concorrente, PN/LID, estado ambíguo, snapshot estático, preservação de edição, atualização de contexto A→B→A, valores alternativos e base incompleta. Uma corrida no arquivo de prontidão do worker de teste foi corrigida com publicação atômica do JSON.

Capturas e resultados sintéticos em [evidências](../evidencias/funil-conversas-atendimento/). Os testes de lista antigos que exigiam navegação por semelhança de telefone foram substituídos pela experiência integrada; testes de polling, mídia, histórico e mutações N:N foram mantidos e executados. Não houve envio real, reprocessamento de mensagem real, acesso a banco instalado, merge, publicação ou deploy.

## Roteiro de homologação

1. Revisar a PR, a V18 e os contratos; conferir o CI do commit final.
2. Ensaiar upgrade em cópia autorizada de desenvolvimento com backup anterior, integridade/FKs, contagens e preservação dos IDs, PDFs e mensagens. Revisar handles conflitantes antes de habilitar o modo autônomo.
3. Usar configuração de desenvolvimento com armazenamento local e autoridade autônoma; manter envio/mídia desligados durante as primeiras verificações. Nenhuma dependência de sincronização antiga deve ser necessária.
4. Com autorização específica para um número controlado, conferir a recepção assinada real, PN, LID sem PN, retry, nome de canal alterado e preservação das edições. Não reproduzir mensagens reais em massa.
5. Confirmar a capacidade/contrato de foto da Evolution instalada, ausência/privacidade e fallback. Validar teclado, foco, rolagem e seleção de referências no aparelho real.
6. Somente mediante autorização própria, homologar envio/mídia ao número controlado, cancelamento, entrega/resposta, falha incerta e troca de contexto. A confirmação do provedor não comprova identidade civil.
7. Conferir cadastro progressivo, múltiplos participantes/contatos/veículos/pagadores, faixa comercial, Encerrados, Diagnóstico/Mapa e emissão de orçamento. Planejamento de implantação/rollback permanece uma etapa separada desta entrega.
