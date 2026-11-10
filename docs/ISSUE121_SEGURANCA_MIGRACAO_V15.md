# FUNIX — Segurança da migração SQLite V14 → V15 (#121)

**Estado:** desenvolvimento, não executado na VPS. Sem autorização de merge, deploy, parada do aplicativo ou acesso aos dados reais.

## Risco confirmado

A Issue #121 adiciona a coluna de rascunho de negociação aos cenários na migração V15. O backend V14 rejeita banco com versão futura. O deploy/funix-deploy atual retorna imagens de contêiner mas **não restaura o SQLite**. Portanto, rollback só dos contêineres não é seguro após a V15.

## Ferramenta proposta

deploy/v15-db-safety.py oferece somente operações offline e explícitas:

- backup ORIGEM DESTINO_NOVO: caminho absoluto, arquivo SQLite V14 íntegro, cópia consistente via SQLite Backup API com dados WAL comitados, validações de versão/tabelas/chaves estrangeiras, SHA-256 e destino restrito (0700, novo arquivo 0600).
- rehearse BACKUP DESTINO_ISOLADO: duplica o backup para arquivo novo e confere seu hash e integridade. Não substitui banco em uso.

O script não para escritores e não faz deploy nem recuperação na VPS. Testes sintéticos: python3 -m unittest discover -s deploy/tests -p 'test_v15_db_safety.py' -v.

## Procedimento sujeito a aprovação

1. Confirmar versão real do FunixApp, versão do SQLite, responsável técnico, espaço, janela, comunicação e armazenamento de backup fora do host.
2. Interromper exclusivamente os escritores do FunixApp e aguardar transações existentes. Manter aplicação inativa até a decisão final.
3. Confirmar na VPS o caminho previsto pelo Compose: /var/lib/funix/app-data/funix.sqlite. Nunca inferir a existência do arquivo.
4. Criar diretório de backup protegido fora do caminho ativo e executar backup por operador autorizado; validar cópia, SHA-256 e integridade. Armazenar segunda cópia protegida.
5. Ensaiar restauração em arquivo isolado e verificar leitura com aplicativo V14; não sobrescrever o arquivo em produção.
6. Somente após aprovação, implantar pelas ferramentas oficiais, conferir API/HTTPS, schema V15, persistência financeira, PDF/histórico e saúde da aplicação.
7. Se falhar depois de migrar: **não executar apenas rollback de imagem**. Manter API/web inativos, reter evidência do arquivo V15, restaurar banco V14 com tratamento dos sidecars -wal/-shm aprovado e validação de integridade, e então retornar às imagens V14. Não descartar gravações posteriores ao snapshot silenciosamente.
8. Reabrir gravações somente após sucesso ou retorno controlado.

## Bloqueios

- Revisão da PR #133 e da integração #114/#121/#123.
- Falha recorrente de voz nativa caracterizada, resolvida ou formalmente aceita.
- Backup real e restauração na infraestrutura autorizada ainda não comprovados.
- Rollback conjunto aplicação + banco ainda não homologado em ambiente real.
- Aprovação expressa da direção antes de merge, migração ou deploy.

**Este documento não autoriza atividades produtivas.**
