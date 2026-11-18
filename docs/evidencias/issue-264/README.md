# Issue #264 — identidade compartilhada entre Chat e Atendimento

Os exemplos usam SQLite e API do aplicativo, Chromium e transporte WhatsApp sintético. A mesma amostra reproduziu a ficha com nome sem telefone e a conversa com telefone sem nome.

| Momento | Captura |
| --- | --- |
| Antes, lista de Conversas | [390 px](antes-conversas-390.png) |
| Antes, Atendimento vinculado | [390 px](antes-atendimento-390.png) |
| Abrir conversa e confirmar a sugestão da ficha | [320 px](identificar-320.png) · [390 px](identificar-390.png) · [1440 px](identificar-1440.png) |
| Abrir o mesmo Atendimento com nome e telefone | [390 px](atendimento-390.png) |
| Pessoa e telefone juntos na edição | [390 px](pessoa-e-telefone-390.png) |
| Nome editado na Entidade refletido na lista original | [390 px](conversas-390.png) |

No caso de uma ficha com uma única pessoa textual, o percurso tem três cliques: abrir a conversa, confirmar a pessoa sugerida e abrir o Atendimento existente. Se a pessoa já estiver cadastrada, a confirmação reutiliza o registro selecionado. Se houver várias pessoas ou Atendimentos possíveis, o operador escolhe o contexto antes de confirmar. O fluxo de gestão detalhada de vínculos continua disponível na própria conversa.

A confirmação usa o número exato do canal, as referências atuais e o recibo idempotente já existente. O número precisa ter evidência da conversa consultada ou de mensagem local, com resolução PN/LID sem conflito. O cadastro guarda apenas o vínculo e as referências. A ação deixa mensagens, demais participantes e histórico do Chat no lugar. A identificação não concede envio ou transferência de titularidade. Telefones legados ainda sem conciliação podem ser consultados em **Telefones informados na ficha**. O schema permanece na V23.

O ensaio automatizado também alterna dois números com históricos diferentes, seleciona uma entre duas pessoas e repete a confirmação com a mesma chave. Não ocorreu criação de Atendimento ou envio neste roteiro. Para repetir em desenvolvimento, execute `node scripts/shared-identity-browser.mjs`. A homologação do caso instalado e a aprovação da direção continuam pendentes.
