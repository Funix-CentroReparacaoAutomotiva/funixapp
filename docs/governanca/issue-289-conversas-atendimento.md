# Issue #289 — Conversas e Atendimentos

O clique principal consulta vínculos atuais e abre a ficha diretamente quando há um único Atendimento elegível. A escolha entre vários vínculos abre a ficha em leitura. O botão de detalhes continua acessível para identificação, criação da ficha e gerenciamento de vínculos. A confirmação de contexto para envio continua explícita.

O primeiro `message.upsert` de saída autenticado, novo e posterior ao corte autônomo passa pelo mesmo fluxo de associação do inbound. Um Contato manual com PN exato mantém seu ID e titular. A criação depende de `FUNIX_CHAT_AUTONOMOUS_ENABLED` e do corte explícito `FUNIX_CHAT_AUTONOMOUS_SINCE`. Antes do corte, mensagens e recibos continuam sendo tratados pelo fluxo existente. Em webhook bruto Evolution, a identificação de conversa consigo mesmo depende da evidência exata do remetente no envelope. Um LID sem PN continua sem número inventado.

A leitura técnica autenticada usa o escopo `technical`; a ficha com vínculo inativo para envio usa o escopo `linked`. Ambos conferem novamente a identidade. A busca de mídia no modo técnico exige mensagem local correspondente e a configuração de mídia já existente. A leitura e snapshots do provedor não criam Atendimentos. Para resgatar uma conversa sem ficha, use o botão secundário, consulte a identidade e vincule explicitamente a um Atendimento existente ou crie a ficha e então vincule. As restrições V25 seguem aplicáveis, inclusive em conflitos de titularidade.

## Conferência instalada após autorização separada

Para os três casos reais da issue, use somente a interface autenticada e inspecione as requisições já geradas pelo clique em Conversas. Registre apenas o rótulo anônimo do caso, o tipo da requisição (vínculos, histórico ou mídia), o status HTTP, o `error.code` e o `requestId` da resposta. Não copie URL completa, IDs, payload, cookies ou capturas com dados pessoais. Compare os tipos de erro com `CHAT_NOT_LINKED`, `CHAT_IDENTITY_CONFLICT` e `CHAT_PROVIDER_*`. Um histórico local legível com envio bloqueado deve manter essa indicação após voltar à lista.

Se o cenário divergir, compare com o responsável do ambiente apenas o estado habilitado/desabilitado da autoridade autônoma, leitura local e mídia, e se existe corte explícito. O diagnóstico desta PR é sintético e não confirma a configuração ou os vínculos do ambiente instalado.

## Atendimento presencial anterior ao Chat

A primeira interação autenticada procura a referência ao Contato canônico antes de abrir ficha nova. Para registros legados, só considera o telefone completo equivalente. Titular divergente, identidade inconclusiva ou múltiplos Atendimentos abertos deixam o histórico disponível para leitura e a associação pendente. A lista de vínculos oferece os candidatos compatíveis para confirmação explícita. Um contexto revogado continua bloqueado, e uma ficha encerrada permanece encerrada.

O ensaio de regressão emite orçamento e OS antes do primeiro webhook de saída e compara a ficha, as referências, os cenários, o orçamento, o PDF, a OS e a Experiência após a saída, o replay e a resposta. Para histórico que só chegou por snapshot, a consulta dos candidatos apenas sugere o vínculo.
