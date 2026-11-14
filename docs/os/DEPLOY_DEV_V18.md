# FUNIX — Atualização controlada do ambiente de desenvolvimento para a OS V18

**Situação:** preparação revisável, não executada na VPS. A direção informa que o FunixApp ainda está em desenvolvimento, sem versão liberada para operação produtiva.

## 1. Infraestrutura confirmada no código

- A PR #221 foi integrada à `main` no commit `9d22ebfff0b4879e706613a1af6baa4839adec6a`; imagens API e web publicadas no GHCR.
- Instância documentada: `app.funix.com.br`; o Compose do projeto `funixapp` usa o SQLite persistente em `/var/lib/funix/app-data/funix.sqlite` no host, montado como `/data/funix.sqlite` na API.
- O workflow `.github/workflows/funix.yml` exige execução manual na `main`, com `deploy=true`, para acessar a VPS. Seu Environment se chama `production`, apesar de a direção classificar o aplicativo como ainda em desenvolvimento.
- A API executa migrações na **abertura do banco**. A V18 cria `work_orders` e impede alteração dos registros. A API de versão anterior recusa banco com migração superior à suportada.
- O script `deploy/funix-deploy` executa rollback de **imagens**, não do SQLite. Retornar somente a API antiga após abrir V18 é inseguro.

**O estado, a versão atual, as permissões e as credenciais da VPS não foram verificados ao vivo. Não presumir que a instância contém V17.**

## 2. Novo preflight sem escrita na origem

O script `deploy/v18-db-safety.py` oferece `inspect`, `backup` e `rehearse`, para um arquivo SQLite **V17 completo**, sem acessar a rede, alterar o schema ou realizar deploy.

- Exige banco existente, caminho absoluto, arquivo regular sem symlink e tabelas essenciais.
- Confere `schema_migrations` de V1 a V17 sem lacunas, `integrity_check` e `foreign_key_check`.
- Para backup usa a SQLite Backup API, incluindo transações já confirmadas no WAL; recusa substituir arquivo já existente.
- Diretório de destino deve pertencer ao executor e ter permissão `0700`; arquivo novo `0600`.
- O ensaio copia somente o **backup já estável**, verifica hash, integridade e schema. Não restaura em lugar do banco em uso.
- Recusa V18 já aplicada, versões anteriores, banco inválido e arquivo ausente. Nesses casos investigar antes de executar.

**O script antigo `deploy/v15-db-safety.py` exige V14 e não pode ser usado para a passagem V17 → V18.**

## 3. Pré-condições de atualização

1. Confirmar que `app.funix.com.br` é a instância de desenvolvimento autorizada; confirmar responsável, estado do servidor, versão da API e do SQLite e espaço disponível. Não criar instância adicional.
2. Agendar uma janela curta sem gravações no aplicativo. Parar **somente** escritores do FunixApp e concluir transações. Outros projetos e serviços na VPS não devem ser alterados.
3. Confirmar por console administrativo o caminho de banco documentado. Guardar a revisão atual e digests de imagem, sem registrar credenciais.
4. Criar diretório de backup separado de `app-data`, privado e de propriedade do operador responsável (por exemplo, `/var/lib/funix/pre-v18`, modo 0700). A partir de checkout conferido e **somente após autorização/inspeção da VPS**, executar:

   ```bash
   sudo python3 deploy/v18-db-safety.py inspect /var/lib/funix/app-data/funix.sqlite
   sudo python3 deploy/v18-db-safety.py backup /var/lib/funix/app-data/funix.sqlite /var/lib/funix/pre-v18/before-v18.sqlite
   sudo python3 deploy/v18-db-safety.py rehearse /var/lib/funix/pre-v18/before-v18.sqlite /var/lib/funix/pre-v18/restore-test.sqlite
   ```

5. Conferir hash SHA-256 idêntico na cópia estável e no ensaio. Guardar uma segunda cópia criptografada e protegida **fora da VPS**; nunca enviar banco real ao GitHub, ChatGPT ou CI.
6. Apenas após checagens aprovadas, executar manualmente **Actions → FUNIX CI and delivery → Run workflow → main → deploy=true**. Nenhum push/merge substitui essa autorização.
7. Após atualização, verificar `/api/ready` e `/release.json` apontando para a mesma revisão; banco em V18 com integridade e FKs válidas; orçamento emitido intacto; fluxo Criar OS → Ver OS → imprimir; persistência após recarregar; mobile.

## 4. Falha e recuperação

Se a V18 já estiver aplicada, **não executar rollback apenas das imagens**: a API anterior não abre esse banco. Suspender as gravações e preservar evidência do SQLite atual antes de decidir. Qualquer restauração V17 deve ser controlada pelo operador, com tratamento correto de `-wal` e `-shm` e com análise de eventuais gravações posteriores ao backup. Sem autorização para perda de alterações, não sobrescrever o banco.

## 5. Status

| Atividade | Situação |
| --- | --- |
| PR #221 integrada à main; validação e publicação GHCR | Concluída |
| Nova ferramenta V17 e testes sintéticos | Criados nesta branch para revisão |
| Inspeção do SQLite real e teste de backup/restauração na VPS | Não realizados |
| Atualização dos contêineres remotos e migração V18 | Não realizadas |
| Homologação da OS na instância hospedada | Pendente |

**Princípio:** dados da instância de desenvolvimento não devem ser descartados por conveniência. A implementação técnica é reversível apenas com recuperação conjunta de aplicação e banco.
