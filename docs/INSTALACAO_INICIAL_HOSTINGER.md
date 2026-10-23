# Instalação inicial FUNIX — uma única preparação

Estado desta entrega: instalador testado em sandbox, sem acesso à VPS. PR separado,
sem merge automático. **Não executar agora na VPS e manter
`FUNIX_DEPLOY_ENABLED=false`**. O procedimento abaixo é para execução futura pelo
administrador, após revisão e integração do PR. Não habilita deploy.

## Preparar antes dos comandos

A VPS deve ser Ubuntu amd64 com Docker já funcionando, Compose >= 2.30,
Python 3, Git, OpenSSH client, sudo/visudo e utilitários padrão. A conta
administrativa precisa de sudo. O instalador recusa pré-requisitos ausentes;
não instala pacotes nem altera Docker, sshd, firewall, DNS ou Traefik.

Confirmar pelo console existente a rede `traefik_default`, Docker provider,
entrypoint `websecure` e resolver `letsencrypt`, capacidade livre e DNS/TLS de
`app.funix.com.br`, conforme [guia existente](IMPLANTACAO_HOSTINGER.md).
O instalador lê apenas as labels (sem coletar ambientes/segredos de outros projetos),
verifica a existência da rede e conflitos em labels de todos os
contêineres, inclusive parados. Não consegue certificar regras em arquivos do
Traefik, routers de outros providers, DNS ou certificados; esses itens continuam
sendo conferência administrativa. Não corrigir serviços de terceiros para passar
no instalador.

### Credenciais mínimas

| Material | Permissão e destino |
|---|---|
| PAT **fine-grained temporário** para baixar o código privado | Somente repositório `Funix-CentroReparacaoAutomotiva/funixapp`, **Contents: Read-only** (Metadata é automático), expiração curta. Informar no prompt de senha do Git; não usar token na URL, arquivo ou comando. Revogar após baixar. Não cadastrar no Actions nem no Docker. |
| PAT **classic** de leitura GHCR | Apenas `read:packages`, sem `repo`, `write:packages` ou `delete:packages`. Preferir conta de serviço com acesso de leitura somente aos packages `funixapp-api` e `funixapp-web`. Autorizar SSO se exigido. O instalador solicita em prompt oculto e salva somente `/etc/funix/registry/config.json`, root 0600, diretório 0700. Base64 no Docker não é criptografia; proteger esse arquivo como senha. Fine-grained PAT não substitui o classic para GHCR. |
| Par Ed25519 exclusivo do deploy | Criar em máquina administrativa segura. Privada apenas no Secret `FUNIX_VPS_SSH_KEY` do Environment `production`; pública no prompt do instalador. Nunca usar a chave root. Chave sem passphrase para o workflow atual, guardada no GitHub Secret. |
| Senha exclusiva do operador | 12–256 caracteres; duas entradas ocultas no instalador. Fica apenas em `/etc/funix/runtime.env`, root 0600. Uma linha, sem CR/quebra de linha. `$`, `#`, espaços e aspas são literais no modo raw. |
| Chave pública do host SSH verificada | Não é segredo de acesso, mas autentica a VPS. Cadastrar linha completa em `FUNIX_VPS_KNOWN_HOSTS`, após comparar fingerprint com o console Hostinger. Nunca confiar só em `ssh-keyscan`. |

Gerar o par SSH na **máquina administrativa**, fora da VPS (um comando adicional):

```bash
ssh-keygen -t ed25519 -N '' -C github-funix -f ./funix-actions
```

Não substituir arquivo existente. Guardar a privada em gerenciador seguro e usar a
interface de Secrets do GitHub; não enviar chaves/tokens ao chat. A pública é o
conteúdo de `funix-actions.pub`; não é necessário copiar nenhum script à mão.

O login GHCR confirma autenticação, **não autorização para cada package**. Conferir
na interface GitHub a visibilidade privada, vínculo e acesso de leitura da conta
a ambos os packages já publicados; o pull por digest será validado no deploy
futuro. Sem acesso, o deploy existente falha no pull antes de trocar a versão.
A publicação usa o `GITHUB_TOKEN` automático; não criar PAT de escrita.

Coda é opcional para preparar e permitir login. Para leitura real, provisionar
credencial com o menor acesso disponível ao documento e preencher, via
`sudoedit /etc/funix/runtime.env`, `CODA_API_TOKEN` e os dois IDs de views conforme
o guia existente. Isso acrescenta **um comando opcional**. Não colocar esses
valores no GitHub ou no código. Sem Coda, consultas indicam indisponibilidade.

## Três comandos na VPS

Executar numa sessão administrativa privada, com diretório `~/funix-bootstrap`
ainda inexistente. O PR já deve estar revisado e integrado na `main`. Não executar
sob gravação de terminal, debug (`bash -x`) ou usando segredos por pipe.

```bash
git -c credential.helper= clone --single-branch --branch main https://github.com/Funix-CentroReparacaoAutomotiva/funixapp.git ~/funix-bootstrap
```

No prompt: usuário GitHub e, como senha, o PAT fine-grained temporário. O helper
vazio impede persistência via credential helper nesta operação. A URL não contém
credenciais. Revogar esse PAT pela interface GitHub após o download.

```bash
git -C ~/funix-bootstrap checkout --detach origin/main
```

Isso fixa o checkout no commit baixado, sem atualização durante a instalação.
Conferir o SHA exibido com o commit revisado no GitHub antes do terceiro comando.
Se divergir, parar e revisar; não executar conteúdo de branch desconhecida.

```bash
sudo bash ~/funix-bootstrap/deploy/funix-install
```

Responder aos prompts: chave pública Ed25519; senha FUNIX e confirmação; login
GitHub de leitura GHCR; token GHCR oculto. Segredos não entram no histórico nem
nos argumentos dos processos. O estágio temporário é privado e apagado ao sair.
O clone contém somente código e pode ser removido depois pelo administrador.

**Contagem:** 3 comandos na VPS, além dos prompts; 1 comando na máquina
administrativa para gerar a chave; configuração única pela interface GitHub.
Não inclui login SSH já existente, reparo de pré-requisitos, configuração opcional
Coda nem eventual habilitação futura do deploy. Não é uma instalação sem interação.

## O que é instalado e o que é recusado

- `/opt/funix/compose.yaml`: Compose existente, root 0644.
- `/usr/local/sbin/funix-deploy` e `funix-ssh`: scripts existentes, root 0755.
- `/etc/funix` e `registry`, `/var/lib/funix` e `releases`: root 0700.
- `runtime.env` e `registry/config.json`: root 0600.
- Usuário/grupo novos `funix-deploy`, senha bloqueada, sem grupos suplementares,
  sem grupo Docker, sem sudo geral. Home e `.ssh` controlados por root.
- `authorized_keys`: chave única com `restrict` e comando forçado existente.
- `/etc/sudoers.d/funix-deploy`: regra existente, validada com visudo, root 0440.

O instalador usa exclusivamente o socket Docker local, verifica Compose e a rede,
valida o Compose com `config --quiet` e faz login GHCR num estágio privado.
**Não executa pull, up, stop, down, prune, restart ou criação de rede.** Nenhum
contêiner FUNIX é iniciado; Traefik, n8n, Evolution, PostgreSQL, Redis e demais
projetos não recebem comandos de alteração.

Recusa qualquer destino já existente (também symlink quebrado), usuário/grupo
preexistente, ancestral sem dono root ou gravável por terceiros, projeto
`funixapp` existente e labels concorrentes de domínio/router/service FUNIX.
Todas as verificações e entradas ocorrem antes da instalação persistente
(exceto lock exclusivo `/run/funixapp-install.lock` e estágio temporário). Não sobrescreve configuração
nem senha ao repetir a execução.

Falha de disco/permissão no momento da gravação pode deixar instalação parcial.
O instalador para e não desfaz automaticamente contas/arquivos: uma repetição
recusa os destinos existentes. Manter deploy desabilitado, revisar o erro e
inventariar apenas os caminhos FUNIX acima e a conta recém-criada. O administrador
deve decidir a recuperação/remoção dos artefatos parciais depois de conferir que
pertencem a esta tentativa. Não há comando de limpeza global ou exclusão automática.
Este instalador serve para primeira preparação, não para atualizar host existente.

## GitHub e automação depois da preparação

No Environment `production`, restrito à `main`, cadastrar os Secrets
`FUNIX_VPS_SSH_KEY` e `FUNIX_VPS_KNOWN_HOSTS`; Variables `FUNIX_VPS_HOST` e
`FUNIX_VPS_PORT` (22 por padrão). Para automação sem aprovação a cada execução,
o Environment não deve exigir required reviewers. Manter proteção/revisão de
`main` conforme política do proprietário.

A **Repository Variable** `FUNIX_DEPLOY_ENABLED` deve continuar `false` (ou ausente).
Não configurá-la apenas no Environment. O instalador não acessa a API do GitHub
para alterar essa variável e esta entrega não a modifica.

Enquanto bloqueado: PRs executam validações; pushes em `main` validam e publicam
imagens privadas no GHCR; **nenhuma atualização da VPS ocorre**.

Somente após autorização futura: habilitar a Repository Variable e disparar o
workflow manual com deploy=true ou fazer novo push aprovado na `main`, conforme
[ativação existente](IMPLANTACAO_HOSTINGER.md#ativação-mínima). A partir daí,
testes, build, publicação, deploy por digest, saúde, recuperação de falha de
contêiner e verificação HTTPS/revisão continuam automáticos no pipeline atual.
Falha de HTTPS externo não provoca rollback automático; consultar o guia.

Mudanças futuras em Compose/scripts privilegiados exigem manutenção administrativa
revisada; a chave de deploy só troca imagens. Não usar este instalador para
sobrescrever a instalação. Renovação de PAT GHCR, rotação de senha/chave e Coda
continuam ações administrativas ocasionais, sem agente permanente.

## Testes reproduzíveis, sem VPS

```bash
for script in deploy/funix-install deploy/funix-deploy deploy/funix-ssh; do bash -n "$script"; done
python3 -m unittest discover -s deploy/tests -v
```

Resultados e limites: [VALIDACAO_INSTALADOR.md](VALIDACAO_INSTALADOR.md).
