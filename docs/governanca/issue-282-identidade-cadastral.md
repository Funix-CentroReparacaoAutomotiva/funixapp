# Issue #282 — Identidade cadastral

Base da PR #283 em `7228e12`. A rodada de revisão foi registrada no parecer 5982543162.

Cadastro, busca, consulta de canal e abertura de conversas usam a mesma chave para telefones brasileiros completos e internacionais explícitos. A evidência de PN/LID continua sujeita às regras do canal. Um número recebido que não pode se tornar uma chave válida gera pendência de identidade e o histórico é preservado.

A V25 calcula as chaves em transação, recusa grupos duplicados antes de gravar e protege a coerência e a unicidade por gatilhos e índice SQLite. A ligação comercial nova exige um Contato associado a uma Entidade e compatível com o canal. O histórico anterior à V25 permanece para conciliação. O procedimento de confirmação pode substituir um titular provisório que ainda não tenha participado de um Atendimento. Quando PN e LID identificam Contatos do mesmo titular, o inbound autenticado pode reconciliar as referências e reter o identificador provisório para auditoria, desde que o contexto permita. Conflito de titularidade mantém os cadastros e bloqueia envio e seleção de contexto.

O cabeçalho do Chat usa a identidade do canal selecionado. A abertura automática usa substituição da entrada de navegação. Alternar históricos mantém o contexto de envio. A leitura vinculada usa mensagens locais, permite recuperar mídia autorizada pelo vínculo e conserva a indicação de histórico incompleto.

## Ensaio e reversão

1. Em uma base sintética V23 ou V24, execute `node server/consolidate-legacy-copy.ts ORIGEM COPIA_NOVA`. O programa cria uma cópia consistente do SQLite e retorna contagens de prévia e aplicação, sem dados pessoais. O mesmo comando aceita V25. Preserve a origem.
2. Confira os grupos duplicados e as razões de pendência. Resolva duplicidades com evidência de titularidade e preserve os IDs históricos. Se o preflight da V25 detectar grupos de números iguais, a migração reverte por inteiro. Consulte o inventário e ensaie novamente após a revisão. Um vínculo histórico sem Contato que a V25 não possa reproduzir entra na contagem de bloqueios.
3. Compare IDs, recibos e documentos protegidos. Confira `PRAGMA integrity_check` e `PRAGMA foreign_key_check`. Repita a consolidação em nova cópia para verificar idempotência. Abra a aplicação a partir da cópia autorizada e confira o histórico, o cabeçalho e os bloqueios antes de qualquer proposta de corte.
4. Para voltar, pare o ensaio e reabra a cópia original com a versão anterior compatível. Uma conexão que escreve Contatos V25 precisa registrar a função canônica usada pelos gatilhos. O servidor e a CLI de consolidação registram essa função.

O ensaio sintético V24 comparou mensagens, vínculos, recibos, IDs de Atendimentos, orçamento emitido, PDF, OS e Experiência após consolidação e restauração. Dois Contatos com o mesmo número foram preservados e relatados para revisão. A V25 foi testada com rollback, nova execução, restrições diretas e chaves de formatos equivalentes. Casos sem prova de titularidade ou de compatibilidade de contexto exigem revisão humana. Dados instalados e homologação compartilhada dependem de autorização própria.
