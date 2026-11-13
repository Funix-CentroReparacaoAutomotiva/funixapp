# WhatsApp ↔ Atendimento — investigação e correção PN/LID

Estado: correção de desenvolvimento, sem merge/deploy nem reparo de registros reais. Base atualizada com `0dce977` (inclui navegação segura/busca #152/#154 e a frente de Diagnósticos #197). Nenhum módulo financeiro foi alterado por esta branch.

## Evidências e diagnóstico

| Cenário | Fato verificado | Conclusão e limite |
| --- | --- | --- |
| A — funciona | Testes exercitam JID exato, evento canônico persistido e envelopes válidos. | Esse caminho é preservado. O exemplo real A não foi individualizado pela direção; não se atribui a ele uma causa específica sem evidência. |
| B — Norte Sul Fabio | Execução n8n `38949`, 12/11/2026 18:42:31 Brasília: evento com PN e `phoneE164:null`, emissor chegou ao recibo 202. Diagnóstico `38984`: PN e LID retornaram HTTP 200, 18 envelopes, incluindo `message:null` e atualização `EDITED`. | O parser da main rejeita o conteúdo nulo e o status EDITED, derrubando a página. Fixture sanitizada: antes `RESPONSE`, depois 18 envelopes. É uma causa reproduzida, independente do telefone vazio; não exclui outras falhas transitórias/configuração em requisições diferentes. |
| C — Drico | Execução `38939`, 12/11/2026 18:30:41 Brasília, encerrou no filtro inicial sem evento. Última mensagem recebida encontrada na primeira página: 07/11/2026 10:20:34; execução `35005` encontrou dois registros Coda, um aberto, decidiu reaproveitar e terminou em `If`, sem recibo FunixApp. O sincronizador entrou no código em 09/11 (`348d441`). | Existe lacuna comprovada no caminho histórico: reconhecer Atendimento no Coda não garante confirmação no FunixApp. A saída recente não dispara o emissor de entradas. O banco instalado não foi consultado; não se afirma ausência absoluta de qualquer evento posterior/reprocessamento ou qual registro local deve ser reparado. Não é correto atribuir a pendência simplesmente à falta de PN alternativo: a listagem examinada o possui. |

A PR #181 foi implantada: GitHub Actions `43333973219`, `completed/success`, SHA `d0de88d88097ef1db8ca6fb0b46b425a908dfb03`. Sucesso de deploy não verifica semântica do histórico.

O workflow **publicado** `21wpOido7t5OHb7i`, versão observada `e67f2d3d-77df-41b2-a144-6c907eba17c6`, contém o emissor HMAC e conferência de 202. Nomes antigos contendo “OFF” não representam seu estado real. A versão publicada e o draft diferem; a investigação usou o grafo publicado.

Diagnóstico novo e isolado: [workflow manual de leitura](https://n8n-eez8.srv2060217.hstgr.cloud/workflow/eaFeXG2ShIZatGRF), no **projeto pessoal**, desativado e não publicado. Quatro consultas limitadas à primeira página de `findMessages`, sem Coda escrito, sem envio/QR/leitura marcada no WhatsApp. Credencial existente foi referenciada, nunca copiada para código ou logs. A primeira tentativa `38983` falhou na expressão antes de consultar o provedor; a execução corrigida `38984` terminou com sucesso. Não reexecutar workflows comerciais para testar sincronização.

| Consulta real `38984` | HTTP | Registros da primeira página | Total/páginas reportados | Anomalia consumida pelo parser |
| --- | --- | --- | --- | --- |
| B, LID | 200 | 18 | 18 / 1 | conteúdo nulo + EDITED |
| B, PN | 200 | 18 | 18 / 1 | conteúdo nulo + EDITED |
| C, LID | 200 | 50 | 332 / 7 | nenhuma nesta página |
| C, PN | 200 | 50 | 111 / 3 | nenhuma nesta página |

Não houve divergência de escopo nas páginas examinadas; cada consulta apresentou uma instância. Os totais são os anunciados pelo provedor, não uma contagem auditada de toda a conversa. A diferença 332/111 comprova que não se deve tratar os dois filtros como intercambiáveis. Não se exportou histórico privado para o repositório. A fixture preserva estrutura, não conteúdo, nomes, JIDs, IDs ou horários reais.

O telefone vazio de B é compatível com a proteção correta do contrato: o normalizador comercial do n8n pode inserir o nono dígito, mas o emissor só preenche `phoneE164` se ele coincidir exatamente com o PN original. Não inventamos ou corrigimos dígitos para conceder acesso.

## Fontes de verdade e avaliação crítica

- **Identidade técnica:** instância + JID exato da Evolution. PN↔LID exige par explícito em chave retornada pelo provedor, dentro do escopo validado; nome/foto/pushName/telefone formatado não constituem equivalência.
- **Atendimento canônico:** confirmação Coda/n8n recebida no contrato assinado, persistida em `coda_sync_*`, por ID de linha Coda. Telefone comercial não autoriza histórico. Associações manuais V20 não substituem essa autoridade nas rotas canônicas.
- **Contexto ativo:** ordenação pelo timestamp original do evento; replays são idempotentes e eventos antigos não voltam o contexto no tempo. Empate de timestamp entre linhas diferentes continua rejeitado pelo contrato existente. O evento rejeitado não recebe 202.
- **Última mensagem:** seu par explícito é evidência útil, porém insuficiente como cache substituível de identidade. A ausência do campo na mensagem seguinte não desmente uma evidência anterior. Um par diferente também não pode apagar a contradição anterior.
- **Vários Atendimentos:** um JID tem um contexto canônico ativo. O Atendimento anterior perde autorização; o atual acessa a conversa do contato, sem partição temporal inventada. Esta mudança não implanta o futuro modelo de arquivo N:N. Contextos PN/LID que apontem para Atendimentos diferentes permanecem bloqueados, mesmo que ambos sejam registros reais.

O que #181 acertou: não usou nomes para vincular, manteve JID do provedor para histórico, verificou o contexto no backend e detectou colisões presentes na página/cache. O que era frágil: aliases em memória com TTL de 30 minutos, descarte ao faltar `remoteJidAlt`, esquecimento de colisões após reinício/expiração, envio direto PN sem examinar colisões e Funil consultando o PN Coda enquanto a lista consultava LID. Além disso, o parser tratava um envelope editado sem conteúdo como falha de toda a conversa.

Alternativas comparadas:

| Alternativa | Avaliação |
| --- | --- |
| Aumentar TTL ou adicionar fallback por telefone/nome | Não resolve reinício/conflito e pode expor outro cliente. Rejeitada. |
| Fundir todos os contatos num cadastro geral novo | Amplia demasiadamente escopo e migração. Desnecessária. |
| Persistir pares explícitos, preservar contradições e consultar a associação Coda atual | Escolhida: resolve as falhas demonstradas sem criar clientes nem outro serviço. |
| Espelhar todo o histórico/mudar Evolution ou o workflow comercial | Não necessário para B; mudaria retenção/operação sem evidência de benefício. |

## Implementação

1. Parser aceita `message:null` como envelope de conteúdo indisponível (`unsupported`, sem texto/mídia inventados) e reconhece `EDITED` como observação do provedor. Não o apresenta como comprovante de entrega. Instância, JID, chave, remetente e timestamp continuam obrigatórios; escopo inválido rejeita a página inteira.
2. Duas tabelas aditivas, abertas somente com o sincronizador já habilitado: `chat_provider_conversations` (UUID opaco estável por instância/JID) e `chat_provider_alias_evidence` (pares PN/LID e primeira observação). Nenhuma versão de migração global/Atendimento existente é reescrita. Com V20 ligado, os UUIDs V20 existentes continuam sendo usados.
3. Evidência explícita da página inteira é registrada antes de resolver qualquer linha. Pares observados no histórico também são registrados, com nova verificação canônica antes da resposta. A ausência posterior não apaga evidência. Contradições ficam em quarentena durável nos dois lados; não há fusão transitiva nem escolha pela observação mais recente. A instância da última mensagem, quando fornecida, precisa corresponder à instância configurada.
4. Lista e Funil usam a mesma resolução persistida de identidade/contexto e preferem o domínio LID conhecido para consulta ao provedor. JIDs opacos anteriores continuam resolvidos dentro do mesmo modo de persistência. Sem evidência de par, permanece o JID exato; sem vínculo, nenhum histórico é aberto no Atendimento.
5. Leitura de mídia registra a evidência da chave validada e revalida o contexto antes de recuperar/devolver o arquivo. Texto/mídia só são enviados ao PN explicitamente confirmado pelo evento canônico atual; uma equivalência PN/LID sozinha não autoriza envio. A verificação ocorre no momento do envio; colisões também bloqueiam o PN direto. Mantidos envio único em andamento e ausência de retry automático de resultado incerto.
6. Falhas do provedor registram somente `event`, `requestId`, operação, código fixo e status HTTP. Interface distingue credencial do provedor, timeout, resposta incompatível e escopo conflitante, com referência correlacionável. O 401 do provedor não é tratado como expiração da sessão do operador.
7. Troca de Atendimento/conversa remonta o Chat. Falha de atualização revoga capacidades de envio; 404/erro de escopo limpam mensagens inclusive em polling silencioso. Nenhum rascunho/permissão passa ao contexto seguinte. A pendência indica conferência do evento Coda/n8n, sem criar ficha ou associar por telefone.

O cache efêmero permanece apenas no consumidor sem sincronizador/persistência canônica, usado também pelos testes offline antigos. Não é a autoridade da integração canônica.

## Recuperação segura e contratos Coda/n8n

O 202 deste endpoint é enviado **depois de COMMIT** de Atendimento/mapeamento/recibo na mesma transação. Não é apenas fila aceita. O fluxo n8n atual confere apenas status 202; a auditoria de uma entrega específica deve correlacionar `eventId`, recibo persistido e ID Coda, não somente o sucesso global do workflow. Não houve alteração do contrato nem do workflow publicado.

Já existem outbox, source ledger, decision ledger e reconciliação no repositório. Não foi criado outro sistema de recuperação. Replays do **mesmo evento confirmado** reaproveitam a linha Coda e o UUID local; eventos diferentes da mesma linha também não duplicam Atendimento. A identidade do provedor, por si só, nunca chama `sync` nem cria Atendimento.

Para o caso C e outros registros anteriores ao emissor:

1. Em acesso autorizado somente de leitura, correlacionar a execução de entrada original, ID da mensagem/evento, instância/JID original e decisão exata de ID Coda (`35005` é o ponto de partida de C). Conferir no Coda que esse ID ainda existe e que a política comercial permite seu uso. Não selecionar registro apenas pelo telefone.
2. Conferir recibos/mapeamentos do FunixApp e possíveis Atendimentos manuais. Se não existir confirmação suficiente, conservar a pendência. Não construir `occurredAt` com a hora da recuperação e não reexecutar o workflow comercial (ele contém escritas/envios).
3. Reproduzir primeiro em SQLite temporário/source+decision ledger/outbox existentes, com evento imutável e ID Coda confirmado; comprovar idempotência e contexto ativo. Ausência de snapshot/decisão exige revisão, não backfill automático.
4. Preparar replay restrito do evento assinado e verificar resultado `existing`/`created` esperado, ID local e ausência de duplicidade. **Aplicação ao banco instalado depende de autorização específica; não executada nesta tarefa.** Se há Atendimento manual equivalente, esta branch não o funde automaticamente.
5. Após autorização e confirmação de persistência, usar “Verificar novamente”. A nova consulta lê o vínculo atualizado sem reiniciar nem criar ficha.

Conflitos de alias exigem revisão das evidências no provedor. Não há botão de sobrescrever identidade, limpeza automática do conflito ou remoção de linhas reais nesta entrega. Um registro sem par nunca visto não pode ganhar acesso só por semelhança telefônica.

## Testes e cobertura

Fixture `server/tests/fixtures/evolution-edited-history.ts`: 18 envelopes da estrutura observada em B, totalmente sanitizados. Comparação executada contra parser da main: `RESPONSE`; parser corrigido: 18 envelopes. Isso demonstra o defeito novo; não é apenas aprovação da suíte antiga.

| Requisito obrigatório | Evidência automatizada |
| --- | --- |
| 1 PN confirmado; 2 LID com PN | `chat-identity-durable` + `chat-evolution-bridge` (leitura e envio) |
| 3 LID sem alternativo | sem evidência anterior bloqueia; ausência posterior preserva par previamente validado |
| 4 alternativo alterado/conflitante | quarentena dos dois PN e LID, preservada em nova instância do bridge |
| 5 evento posterior à lista | resolvedor atualizado sem nova ficha |
| 6 duplicado/fora de ordem | Coda idempotente, contexto mais recente preservado |
| 7 falha de histórico; 8 vazio legítimo | erro propagado/recuperável versus página vazia autorizada; HTTP auth/timeout/scope/response separados |
| 9 Funil/lista; 10 reinício/TTL | mesmo JID LID, UUID e autorização após fechar/reabrir arquivo SQLite e após 31 minutos |
| 11 duas conversas/identificador | conflito encontrado em páginas diferentes bloqueia ambas, inclusive envio PN direto |
| 12 vários Atendimentos no tempo | contexto anterior perde acesso, histórico só no ativo; PN/LID divergentes bloqueados |
| 13 envio válido; 14 envio ambíguo/mudança | texto e mídia com PN canônico; mudança ativa/colisão impede efeito externo |
| 15 isolamento | identidade/instância inválida e mudança durante fetch nunca devolvem histórico no Atendimento incorreto |
| 16 sem duplicação na reconciliação | observar/reobservar identidade não cria Atendimento; replays mantêm um UUID por ID Coda; regressões existentes de outbox/reconciliação |

Verificações executadas: `npm run check` (build, TypeScript servidor, toda suíte servidor, lint e voice-cost), testes focados de parser/bridge/persistência, e Chromium em **320, 390 e 1440 px**. Navegador usa apenas localhost, banco sintético e Evolution simulada: leitura, mídia, envio simulado, polling sem duplicação, busca/navegação canônica, erro com referência/retry e revogação silenciosa de histórico/compositor. Resultados finais agregados em `docs/evidencias/chat-identity/validation.json`.

Limites: não houve envio real de texto/mídia, teste da imagem instalada após deploy, consulta ao SQLite instalado ou replay de C. O diagnóstico real cobriu primeiras páginas; não valida todas as páginas/campos presentes na base. Paginação Evolution continua offset, sem snapshot: contagens são indicativas, ordenação/alterações concorrentes podem gerar lacunas; não se declara completude. Formatos desconhecidos não viram texto fictício. Lint aceita advertências existentes; build alerta bundle acima de 500 kB.

## Implantação, compatibilidade e reversão (não executadas)

- Revisar PR e obter autorização específica antes de merge/deploy. Backup consistente do SQLite e imagem anterior identificada. Nenhuma credencial/flag nova; o sincronizador usa as flags e HMAC existentes. Não ligar reconciliação, V20, envio ou mídia como efeito desta correção.
- Na inicialização autorizada, `createCodaEventSchema` acrescenta as duas tabelas e índice transacionalmente. Não importa clientes/eventos legados, não altera `schema_migrations`, vínculos antigos ou catálogos. Backup SQLite inclui as novas tabelas. Validado close/reopen sintético.
- Fazer uma listagem autorizada para registrar evidências PN/LID antes de exigir resolução por aliases no Funil. Se nunca houve evidência registrada, reiniciar o backend não pode inventá-la. Testar instância, escopo e disponibilidade do histórico, não apenas `/health`.
- Conferir B sem erro, mesmo Atendimento pelo Funil/lista, envelope indisponível sem conteúdo fabricado, referências estruturadas e C bloqueado até confirmação. Recuperação legada é operação separada com plano acima.
- Se falhar, interromper o rollout. Em reversão autorizada, manter tabelas aditivas e Atendimentos; não executar DROP nem restaurar backup antigo por cima de mensagens/eventos posteriores. A imagem anterior ignora as tabelas extras. Como ela perde a proteção durável de conflitos, suspender leitura/envio afetados até revisão em vez de considerar o retorno à #181 uma correção segura. Mudanças produtivas de flags também dependem de autorização.

## Aceitação pelo celular

Somente após implantação autorizada, sem enviar mensagens de teste:

1. **A:** abrir uma conversa antes funcional, conferir Atendimento/nome e algumas mensagens reconhecidas. Voltar ao Funil e abrir o mesmo Atendimento: mesma conversa. Atualizar e repetir após reinício autorizado.
2. **B — Norte Sul Fabio:** abrir pela lista, depois pelo Funil. Conferir que o histórico carrega e que o telefone vazio não impede a consulta. O registro sem conteúdo deve permanecer indisponível; não deve aparecer texto inventado nem impedir as demais mensagens.
3. **C — Drico:** antes da recuperação, confirmar pendência segura e ausência de nova ficha/histórico em outro Atendimento. Após replay canônico especificamente autorizado, usar “Verificar novamente”: abrir o registro previamente confirmado e conferir o histórico pelo LID também no Funil.
4. Se houver erro, guardar apenas código de referência e horário, sem copiar conversas. Uma falha de provedor deve permitir atualização; perda de vínculo deve retirar mensagens e compositor. Não reenviar mensagem com resultado incerto.
