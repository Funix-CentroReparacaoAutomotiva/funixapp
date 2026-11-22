# Issue #289 — Conversas e Atendimentos

O clique principal consulta vínculos atuais e abre a ficha diretamente quando há um único Atendimento elegível. A escolha entre vários vínculos abre a ficha em leitura. O botão de detalhes continua acessível para identificação, criação da ficha e gerenciamento de vínculos. A confirmação de contexto para envio continua explícita.

O primeiro `message.upsert` de saída autenticado, novo e posterior ao corte autônomo passa pelo mesmo fluxo de associação do inbound. Um Contato manual com PN exato mantém seu ID e titular. A criação depende de `FUNIX_CHAT_AUTONOMOUS_ENABLED` e do corte explícito `FUNIX_CHAT_AUTONOMOUS_SINCE`. Antes do corte, mensagens e recibos continuam sendo tratados pelo fluxo existente. Em webhook bruto Evolution, a identificação de conversa consigo mesmo depende da evidência exata do remetente no envelope. Um LID sem PN continua sem número inventado.

A leitura técnica autenticada usa o escopo `technical`. A ficha com vínculo inativo para envio usa o escopo `linked`. Ambos conferem novamente a identidade. A busca de mídia no modo técnico exige mensagem local correspondente e a configuração de mídia já existente. A leitura e snapshots do provedor não criam Atendimentos. Para resgatar uma conversa sem ficha, abra o histórico e confira os vínculos. Quando houver um candidato, confirme o vínculo com a ficha existente. Com histórico disponível, PN inequívoco e nenhum candidato, o operador pode selecionar **Criar Atendimento de triagem**. O servidor confere os critérios novamente, cria e vincula a ficha na mesma transação e abre seu histórico. O contexto de envio exige seleção separada. As restrições V25 seguem aplicáveis, inclusive em conflitos de titularidade.

## Conferência instalada após autorização separada

Para os três casos reais da issue, use somente a interface autenticada e inspecione as requisições já geradas pelo clique em Conversas. Registre apenas o rótulo anônimo do caso, o tipo da requisição (vínculos, histórico ou mídia), o status HTTP, o `error.code` e o `requestId` da resposta. Não copie URL completa, IDs, payload, cookies ou capturas com dados pessoais. Compare os tipos de erro com `CHAT_NOT_LINKED`, `CHAT_IDENTITY_CONFLICT` e `CHAT_PROVIDER_*`. Um histórico local legível com envio bloqueado deve manter essa indicação após voltar à lista.

Se o cenário divergir, compare com o responsável do ambiente apenas o estado habilitado/desabilitado da autoridade autônoma, leitura local e mídia, e se existe corte explícito. O diagnóstico desta PR é sintético e não confirma a configuração ou os vínculos do ambiente instalado.

## Atendimento presencial anterior ao Chat

A primeira interação autenticada procura a referência ao Contato canônico antes de abrir ficha nova. Para registros legados, só considera o telefone completo equivalente. Titular divergente, identidade inconclusiva ou múltiplos Atendimentos abertos deixam o histórico disponível para leitura e a associação pendente. A lista de vínculos oferece os candidatos compatíveis para confirmação explícita. Um contexto revogado continua bloqueado, e uma ficha encerrada permanece encerrada.

O ensaio de regressão emite orçamento e OS antes do primeiro webhook de saída e compara a ficha, as referências, os cenários, o orçamento, o PDF, a OS e a Experiência após a saída, o replay e a resposta. Para histórico que só chegou por snapshot, a consulta dos candidatos apenas sugere o vínculo.

Uma ficha legada cadastrada apenas com nome e telefone pode aparecer como candidata quando o PN completo coincide. Confirme o vínculo com o ID da ficha original. A falta de titularidade confirmada impede o vínculo automático. A confirmação de contexto de envio é uma operação separada e continua sujeita às validações de identidade e autorização.

## Numeração móvel abreviada no WhatsApp

Uma mensagem autenticada com telefone completo reutiliza a ficha textual única e compatível. O registro criado para o contato usa a própria pessoa já informada na ficha. A prévia e a leitura de histórico continuam sem iniciar Atendimento automaticamente.

Se o WhatsApp apresentar um número abreviado e houver uma ficha plausível, em **Conversas → Gerenciar vínculos**, localize a ficha e escolha **Revisar numeração**. Confira os dois números, informe o motivo e confirme. O aplicativo registra a revisão e abre o histórico na mesma ficha. O telefone do cadastro permanece íntegro. A consulta `whatsappNumbers` da Evolution pode devolver variantes criadas pelo cache e a presença de um dígito adicional serve apenas para localizar candidatos.

Uma interação nova de número abreviado sem Contato, ficha ou outro Chat plausível cria triagem provisória e mantém visível o número recebido pelo canal. Para um histórico sem evento novo, o botão de triagem exige histórico disponível e ação explícita. A triagem provisória guarda o telefone civil em branco. O vínculo revisado e o provisório são de leitura e o sistema bloqueia a seleção de contexto de envio. Divergência de titularidade ou identidade continua em revisão, com as mensagens preservadas.

### Validação e reversão

A extensão SQLite preserva o número da versão V25 e adiciona registros de revisão e travas de envio. A transação guarda a escolha, o motivo e os identificadores internos sem substituir documentos comerciais ou mensagens. Em reversão de imagens, preserve o banco atual. As versões anteriores abrem a mesma V25 e podem deixar indisponível a leitura das conversas tratadas pela extensão. Os registros e as travas permanecem no banco.

Para a conferência instalada, usar o fluxo oficial de deploy com backup SQLite íntegro e uma sessão autenticada. Conferir uma ficha existente com orçamento, uma primeira mensagem sem ficha, a consulta pelos dois lados e a ausência de envio ao confirmar o vínculo. Registrar somente resultados agregados e códigos de erro. O inventário de cópia distingue vínculos de leitura confirmados de números pendentes de verificação.
