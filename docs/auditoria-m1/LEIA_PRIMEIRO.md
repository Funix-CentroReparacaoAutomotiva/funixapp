# Auditoria independente — FUNIX M1.1

Pacote da implementação existente para homologação; não autoriza outro incremento, push, deploy ou alteração produtiva. Nenhum código funcional foi alterado na preparação desta auditoria. Somente documentação/evidências foram acrescentadas e os testes foram reexecutados com dados sintéticos.

## Conteúdo e ordem de revisão

1. `codigo/docs/M1_ATENDIMENTOS.md`: relatório da entrega.
2. `METADADOS.json` e `ARQUIVOS_DO_COMMIT.txt`: branch, commits, árvore-base, escopo e relação exata dos arquivos incluídos no commit local.
3. `diff/M1_COMPLETO.patch`: diff Git completo, inclusive arquivos novos e alterações binárias, entre a base anterior e o commit da entrega. `diff/RESUMO.txt` e `diff/ESTATISTICAS.txt` facilitam a navegação.
4. `codigo/`: cópia dos fontes relevantes, configurações de build/teste, arquivos modificados e documentação. Não é uma cópia de dependências instaladas.
5. `codigo/docs/auditoria-m1/logs/`: saídas de testes reexecutados para esta auditoria. Comandos e limites em `TESTES.md`.
6. `codigo/docs/evidencias/m1-*`: relatório e screenshots com registros exclusivamente sintéticos.
7. `MANIFESTO_SHA256.json`: hashes dos arquivos do ZIP, exceto do próprio manifesto.

O diff é a referência de completude das alterações; a cópia `codigo/` também inclui arquivos necessários ao funcionamento que não foram alterados. Há contratos/adaptador Coda legados preservados, mas o servidor ativo não os instancia. Isso deve ser distinguido de acesso real ao ERP.

## Escopo a auditar

Criar, salvar, pesquisar, abrir, editar e reabrir Atendimentos no SQLite próprio. Avaliar autenticação/origem, validação mínima de telefone, opcionais, ausência de deduplicação civil, UUID estável, concorrência por revisão, migração, backup, busca, contexto de cabeçalho, retorno, preservação do formulário em erro e limites de Chat/IA/ERP.

O M1 completo (catálogos, diagnóstico, motor, versões/PDF) não está entregue. Não transformar sua ausência em declaração de que este subincremento a implementou. Tampouco tomar os testes como garantia automática de integridade: confrontar código e evidências, destacando lacunas reais.

## SQLite em vez de PostgreSQL

Escolha proporcional ao primeiro uso: operador único, uma instância da API, dados locais e transações pequenas. O Node 24 já fornece `node:sqlite`, evitando novo serviço PostgreSQL, credenciais, rede e dependências de ORM. Não é uma decisão de escalabilidade definitiva; múltiplas réplicas/escritores ou exigências operacionais maiores poderão justificar nova avaliação, sem implementá-la preventivamente agora.

O arquivo padrão em desenvolvimento é `.runtime/funix.sqlite`, configurável por `FUNIX_DATABASE_PATH`. Arquivo 0600, novos diretórios 0700, fora do Git. Sessões permanecem em memória; reiniciar API pede novo login, sem apagar o arquivo SQLite. Formulário ainda não salvo não é persistência confirmada.

## Persistência futura no contêiner — condição ainda NÃO implantada

O Compose atual NÃO possui volume para esse banco e não foi alterado. O caminho de produção explícito exigido pelo código NÃO comprova, sozinho, durabilidade. Guardar o banco na camada do contêiner ou em tmpfs perderia dados ao recriá-lo; não implantar assim.

Após autorização separada, será necessário montar armazenamento durável exclusivo do FUNIX (bind mount de diretório na VPS ou volume nomeado) no caminho configurado em `FUNIX_DATABASE_PATH`, com permissão para o usuário não root da API. Esse mesmo armazenamento precisa ser reutilizado em toda atualização/recriação; não usar comandos que removam o volume. Nenhum serviço existente precisa compartilhar o arquivo SQLite. Não foram executados comandos de instalação/mount na VPS.

Além do volume, será necessário manter backups consistentes por `npm run db:backup -- DESTINO_NOVO`, cópias protegidas fora do disco da VPS e teste de restauração. A CLI usa o backup nativo SQLite, não uma cópia cega de banco aberto. Restore manual com API parada, versão de schema compatível e preservação do arquivo anterior. Restauração/backup não estão automatizados na VPS.

Os smoke tests Docker usam banco DESCARTÁVEL em `/tmp`, intencionalmente. Não são prova de persistência após recriação de contêiner. O teste de navegador e os subprocessos comprovam persistência em arquivo entre reinícios locais; a configuração de volume da futura VPS continua sendo requisito não executado.

## Limitações e decisões pendentes

- Prefixo legível de origem do Atendimento ainda sem string aprovada; UUID técnico não depende dessa escolha.
- Sessões em memória, autenticação compartilhada de operador e limitador herdado pelo endereço do peer; atrás do proxy, tentativas podem compartilhar limite.
- Campos não enviados ao backend não sobrevivem necessariamente a encerramento abrupto do navegador; aviso não equivale a autosave.
- Apenas uma instância da API com SQLite local neste desenho; não se promete alta disponibilidade ou atualização sem interrupção.
- Regras temporais do Funil não automatizadas. Rejeição exige confirmação explícita e motivo.
- Códigos ausentes na hierarquia V2 e divergência 163/164 permanecem documentados; catálogos próprios ainda serão fornecidos. Não há precificação/seleção de peças implementada.
- Sem integração de escrita Coda, WhatsApp ou IA. Ambiente produtivo, volume, backup externo e capacidade da VPS não foram homologados por esta entrega.
- Quatro avisos React de efeitos permanecem; saídas detalhadas estão nos logs. Não houve refatoração preventiva.

## Sigilo e material de teste

Não incluir `.env` real, credenciais operacionais, bancos, dependências, dumps de linhas Coda ou dados de clientes. `.env.example` é modelo com campos de segredo vazios. Os testes contêm fixtures de autenticação sintéticas necessárias à execução; não são senhas de uso da FUNIX. Screenshots e registros do runner são explicitamente sintéticos. Os documentos originais anexados são referências fornecidas pela direção, não exportações de registros produtivos.
