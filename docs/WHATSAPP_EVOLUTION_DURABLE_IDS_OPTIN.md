# FUNIX — Leitura Evolution opt-in no FunixApp existente (sem migração agora)

**Status:** preparação de código para revisão. **Não habilitado, não implantado.** A PR está empilhada sobre a #86. A VPS atual é o ambiente de teste operacional do FunixApp; a Evolution e o n8n continuam atendendo à operação real da FUNIX.

## Decisão técnica após o CI

A primeira tentativa desta PR adicionou uma migração SQLite V15 só para persistir IDs de conversas. Ela foi **retirada antes de merge**, porque vários testes dependiam de versões exatas de migração e, sobretudo, porque a versão anterior do FunixApp não conseguiria abrir o banco V15 após um rollback de imagem. Introduzir esse risco **antes de ter a associação N:N V20** não oferece benefício proporcional.

**Decisão de trabalho:** nesta entrega, manter V14 e os IDs opacos **efêmeros** da PR #86, que expiram em até 30 minutos/reinício. Não afirmar persistência de IDs. Implementar IDs estáveis junto de **uma única migração futura, aditiva e cuidadosamente testada**, que inclua a associação N:N conversa/Atendimento e plano verificado de backup, restauração e reversão.

## Código desta PR

- `server/chat/evolution-config.ts`: carrega o leitor Evolution apenas quando `FUNIX_EVOLUTION_READ_ENABLED=true` **exatamente**. Exige chave backend e ID técnico de instância válidos. Sem variáveis, não abre rede nem ativa rotas.
- Endereço interno fixado em `http://evolution-api-nvzq-api-1:8080` e alias `funix_comercial`, conforme DNS/TCP validado na VPS existente. Evita receber URL arbitrária de usuário ou variável.
- `server/index.ts`: injeta a ponte opt-in apenas sob configuração válida. A chave fica no backend, não no navegador.
- `server/tests/evolution-config-optin.test.ts`: casos sintéticos da flag, credencial ausente, ID inválido e caminho feliz sem executar conexão.

**Nenhuma mudança de schema ou migrador nesta PR.** Módulos e testes experimentais sem uso da Evolution produtiva. A ponte e as rotas são as mesmas da PR #86, com escopo somente leitura e sessão do proprietário.

## Variáveis previstas para a instalação já existente (não configurar ainda)

A habilitação futura, somente com autorização e no arquivo de configuração protegido do FunixApp, usaria:

```ini
# Omitida ou desativada por padrão:
FUNIX_EVOLUTION_READ_ENABLED=false
# Valores protegidos; sem valores reais em chat, git ou logs:
# FUNIX_EVOLUTION_READ_API_KEY=<segredo>
# FUNIX_EVOLUTION_INSTANCE_ID=<ID técnico validado>
```

A chave disponível no contêiner da Evolution **não existe automaticamente** no contêiner do FunixApp. Não imprimir `docker inspect` completo, `env`, arquivos de segredo, URLs privadas ou conteúdo de clientes para descobrir a credencial. A conexão TCP positiva não prova autenticação do FunixApp perante a Evolution.

## Gate para ativação no FunixApp atual

1. CI verde da PR #86 e desta PR, com testes de sessão, escopo e timeout.
2. Validar metadado do ID técnico da instância `funix_comercial`, sem acessar mensagens/contatos reais.
3. Confirmar procedimento seguro para disponibilizar chave no backend e para guardar/restaurar a configuração anterior.
4. Revisar finalidade/privacidade da leitura: o navegador receberá conteúdo de conversas reais **somente após autorização explícita**.
5. Aprovar merge e **deploy manual na VPS atual**, com validação de prontidão e rollback da imagem. **Não** ligar flag automaticamente no merge.
6. Testar a funcionalidade inicialmente sem ativar envio, recebimento de eventos, mídia, sincronização ou N:N persistente.

## Limitações explícitas

- IDs de conversa não são permanentes nesta fase. Atualizar a lista após reinício/expiração.
- A lista de chats pode não incluir todo histórico; a paginação `page/offset` não é snapshot estável e pode sofrer lacunas/duplicações.
- `capabilities.messages=false` continua; não prometer UI operacional, envio, entrega, status real ou mídia.
- Nenhuma mudança em Evolution, n8n, PostgreSQL, Redis, webhook, ERP, Compose ou rede.
- Uma futura migração N:N do SQLite **exigirá** backup consistente, restauração verificada, teste de regressão e plano de rollback, com risco de perda de escritas entre versões tratado pela direção.
