# Issue #282 — Identidade cadastral

Base de desenvolvimento 7228e12, a mesma da auditoria registrada na issue. Esta revisão implementa parte dos critérios de aceite.

- Cadastro e consulta de canal compartilham a normalização de números brasileiros completos e de internacionais explícitos. Valores incompletos continuam visíveis e não geram chave, consulta ou envio. A evidência de provedor continua sujeita às regras do canal.
- A abertura explícita da conversa verifica colisões por número e por handles relacionados. Quando o número já pertence a um titular, exige que esse titular esteja referenciado no Atendimento antes de reutilizar o Contato. O primeiro evento recebido pode reutilizar um Contato cadastrado sem criar outro titular. Colisões identificadas retêm a mensagem e bloqueiam o contexto.
- A seleção de histórico no Atendimento usa a conversa na URL. Uma conversa elegível é selecionada automaticamente. O botão de contexto comercial permanece uma ação explícita.
- A consolidação offline aceita V23 e V24, mantém o preview transacional e informa a contagem anônima de grupos com telefones duplicados.

## Ensaio e reversão

Execute `node server/consolidate-legacy-copy.ts ORIGEM COPIA_NOVA` em um banco sintético V23 ou V24. Guarde a origem para restauração e use somente a cópia no ensaio. Confira `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, as pendências anônimas e os IDs e contagens das tabelas protegidas. Repita o ensaio a partir da cópia, gerando um terceiro arquivo, para conferir a idempotência. Para reverter, pare o ensaio e reabra a origem com a versão compatível do aplicativo. Dados instalados e homologação em ambiente compartilhado dependem de autorização própria.

O ensaio sintético V24 executou a CLI em uma cópia nova, conferiu os IDs dos Atendimentos e comparou as tabelas protegidas linha a linha, incluindo mensagens, vínculos e recibos de Chat, orçamento emitido, PDF, OS e Experiência. A cópia passou nos dois PRAGMAs e na segunda execução. O backup da origem foi reaberto e comparado com o estado anterior à conciliação. O relatório contou um PN duplicado em dois Contatos, preservados para revisão.

## Pendências de aceite

- Restrição SQLite para unicidade de PN e vínculo comercial obrigatório com Contato, com preflight e tratamento auditável das duplicidades.
- Autoridade transacional única para edições textuais e todos os vínculos legados. Reconciliação de LID provisório com PN já cadastrado quando houver prova suficiente, preservando os casos conflitantes.
- Cobertura integrada de múltiplos Chats, seleção de contexto, atualização de nome e telefone no cabeçalho.
