# FUNIX — implantação do MVP para homologação (NÃO executada)

**Estado:** proposta de homologação isolada. Nenhum serviço na VPS foi alterado por esta branch. A publicação da imagem candidata no GHCR, quando CI concluir, **não publica o site**. A URL `https://hml.funix.com.br` é **proposta**, não DNS/TLS comprovado.

## Razão para isolar

A aplicação atual `app.funix.com.br` roda Compose `funixapp`, release `bb2e551c...`, com API legada Coda. O MVP do PR #8 pertence à branch comercial e requer SQLite gravável. Não usar `/opt/funix/compose.yaml`, `/etc/funix/runtime.env`, `/var/lib/funix/current.env` ou `funix-deploy` para homologação. A senha da homologação deve ser independente da senha vigente.

A proposta usa `name: funixhomologacao`, web+API próprios, imagens GHCR tag `hml-<SHA>` (converter para **digests imutáveis** depois do build), roteadores Traefik com nomes independentes em `hml.funix.com.br`, rede Traefik compartilhada existente sem editá-la, bind `/var/lib/funix/homologacao/data:/data` somente API. O UID do usuário Node na imagem é 1000. Sem novos bancos externos, Redis, serviços pagos ou migração Coda.

## Gates antes de qualquer comando mutável na VPS

1. **Decisão de hostname:** direção confirma `hml.funix.com.br` ou indica outro. Criar DNS via Cloudflare só mediante autorização e após conferir IP de origem e proxy; não assumir que já existe registro.
2. **Capacidade da VPS:** conferir `free -h`, `df -h`, `docker stats --no-stream` seletivamente, serviços Traefik existentes. A homologação reservará limites nominais de RAM de 384 MiB API + 128 MiB web (não equivale a uso real); não pressionar n8n/Evolution.
3. **Imagem candidata:** CI de branch `homologacao/mvp-comercial` verde e dois digests GHCR resolvidos. Não instalar tag mutável sem digest. Confirmar pull no host sem editar produção.
4. **Composição isolada:** `deploy/homologacao.compose.yaml` validado tanto em runner como na VPS antes de subir. Montagens tmpfs equivalentes às já reparadas; check `/data` gravável por UID 1000.
5. **Segredo:** operador cria senha forte nova diretamente em `/etc/funix/homologacao.env` com owner root/mode 0600, **jamais envia senha ao ChatGPT/GitHub**. Esse arquivo não é `/etc/funix/runtime.env`.
6. **Backup:** a instância começa com banco limpo; configurar backup consistente com a API Node/SQLite (não copiar banco ativo a quente com `cp`), destino fora do volume/servidor quando a homologação gerar dados importantes e ensaiar restauração; não automatizar rotina complexa sem necessidade.
7. **Execução controlada:** separar diretório root-owned de homologação do `/opt/funix` da produção. Não usar `docker compose down` sem especificar a stack ou qualquer `docker system prune`. Validar roteadores, HTTPS, `/api/ready`, `/release.json` com **mesmo SHA**, login e criação/recuperação de Atendimento sintético.
8. **Homologação:** proprietário testa o fluxo ponta a ponta no celular/PC. Dados de teste claramente identificados; não enviar PDF sintético a clientes. Só considerar uso real após autorizações funcionais e formato/documento/centavos.

## Atenções técnicas

- A pipeline existente `.github/workflows/funix.yml` publica imagens apenas em `main`. A nova `homologacao.yml` publica **candidatos de branch** sem comando de SSH/deploy. **Verificar se a política GitHub permite a publicação**; se não, resolver no próprio GitHub, sem atalhos na VPS.
- O `FUNIX_DATABASE_PATH` no contêiner é `/data/funix.sqlite`. Diretório de host criado *apenas no gate operacional autorizado*, com usuário/grupo adequados e permissões restritas. Caso indisponível, API falha explicitamente; não desabilitar gravação nem migrar para `/tmp`.
- O Compose inclui `FUNIX_APP_ORIGIN=https://hml.funix.com.br`; login exige origem exata. Se o hostname mudar, atualizar também os dois roteadores, documentação e testes.
- A instância anterior nunca é removida por esta configuração. `funix-deploy` controla apenas `funixapp`; não deve ser reutilizado para `funixhomologacao`.
- Esta proposta depende da **autorização de publicação real** antes de alterar DNS, Traefik, Docker ou volumes. Branch/PR e imagens candidatas **não autorizam** operação produtiva.
- Ajustes de apresentação das frações de centavo, validação de catálogos reais e formato do documento continuam reservados à homologação do proprietário.

## Critérios de aceite da preparação

- [ ] CI da imagem candidata verde no SHA final
- [ ] Dois digests GHCR verificados
- [ ] Endpoint e DNS de homologação aprovados
- [ ] Espaço/RAM considerados suficientes para os dois novos contêineres
- [ ] Compose e caminhos isolados da produção
- [ ] Volume SQLite de homologação independente e gravável
- [ ] Backup e restauração demonstráveis
- [ ] Produção `app.funix.com.br` mantida na revisão anterior
- [ ] Acesso HTTPS da homologação confirma revision web/API
- [ ] Proprietário recebe somente link e credencial criada por ele, não instruções de Node local
