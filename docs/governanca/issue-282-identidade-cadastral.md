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

## Roteiro de pré-homologação

Trabalhe em diretório restrito, com `umask 077`, a partir de backup SQLite consistente e autorizado. Registre a versão retornada pelo inventário da cópia e a revisão da aplicação que gerou o backup. O inventário aceita V23, V24 e V25. Para ensaiar o corte V25, parta de uma cópia V23/V24. Cópias V25 de builds draft anteriores não servem como ensaio de migração.

```sh
umask 077
node server/inventory-customer-copy.ts "$ORIGEM" "$PENDENCIAS"
node server/consolidate-legacy-copy.ts "$ORIGEM" "$CONCILIADA"
node server/inventory-customer-copy.ts "$CONCILIADA" "$PENDENCIAS_CONCILIADAS"
```

O inventário retorna somente contagens em stdout. O arquivo opcional é criado exclusivamente com permissão 0600 e contém os IDs, incluindo cada grupo de duplicatas, os Contatos sem titular, as chaves nulas ou divergentes, os Atendimentos com telefone identificado textual e os vínculos sem Contato ou incompatíveis. Use esses IDs somente na área restrita para confrontar o cadastro e a evidência do canal. Divulgue apenas as contagens. Código de saída 2 indica pendências e bloqueia a proposta de corte. Fichas de fato sem número e referências textuais sem identidade comprovada podem permanecer pendentes. A consolidação não funde Contatos conflitantes.

Depois de resolver cada grupo e vínculo identificado com evidência documentada, rode o inventário novamente. Separe os resultados esperados da preparação, como a recomposição de chaves derivadas, e confira-os após o upgrade. Crie uma segunda cópia consistente da versão conciliada para o upgrade e retenha a conciliada pré-upgrade:

```sh
node --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; import {backupDatabase} from "./server/database.ts"; const db=new DatabaseSync(process.argv[1],{readOnly:true}); try { await backupDatabase(db,process.argv[2]) } finally { db.close() }' "$CONCILIADA" "$ENSAIO"
node --input-type=module -e 'import {openDatabase} from "./server/database.ts"; openDatabase(process.argv[1]).close()' "$ENSAIO"
node scripts/verify-v19-copy.ts "$CONCILIADA" "$ENSAIO"
node server/inventory-customer-copy.ts "$ENSAIO"
```

Repita a abertura e o inventário na mesma cópia e compare contagens. Para o rollback do ensaio, restaure a cópia pré-upgrade em outro arquivo a partir do backup retido e abra com a revisão anterior compatível. Valide integridade, vínculos e documentos preservados antes de apresentar o resultado da homologação. Uma base instalada ainda depende de aceite separado.
