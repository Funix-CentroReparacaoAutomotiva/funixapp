# Validação do instalador inicial

Executado em ambiente de desenvolvimento isolado em 23/10/2026. Nenhum acesso à
VPS Hostinger, instalação real, alteração de secrets/variables do GitHub ou
habilitação de deploy. O trabalho remoto limita-se à branch e PR desta entrega.

| Verificação | Resultado |
|---|---|
| `bash -n deploy/funix-install deploy/funix-deploy deploy/funix-ssh` | Passou |
| `python3 -m unittest discover -s deploy/tests -v` | 13 testes passaram: 6 do instalador e 7 de regressão do deploy existente |
| Compose real 2.40.3 `config --quiet` | Passou com cópia temporária do Compose e runtime sintético; sem daemon, pull ou contêiner |
| Diff | Sem erros de whitespace; Compose e scripts de deploy/SSH/sudoers existentes preservados |
| Workflow | Acrescentada somente checagem de sintaxe do instalador; discovery existente já inclui os novos testes. Condições de deploy/publicação preservadas |

Os testes executam o **script instalador real**, remapeando os caminhos absolutos
para diretório temporário. Checagens de UID e operações de ownership são adaptadas
ao usuário não root da sandbox. Docker, getent, useradd, passwd, chown e visudo são
simulados; ssh-keygen, Bash, criação de arquivos, modos, flock e o verificador de
labels são exercitados de fato. Nenhum daemon, usuário ou sudoers real é alterado.

Cobertura do instalador:

- Instalação de arquivos com modos esperados, senha literal com `$` e `#`, chave
  pública com restrições; segredos ausentes de stdout/stderr e argumentos.
- Reexecução recusada sem sobrescrever senha/configuração existente.
- Falhas de rede Traefik ausente, Compose antigo, conta existente ou login GHCR
  recusado, antes da instalação persistente.
- Projeto `funixapp`, domínio ou nomes de routers/services concorrentes em labels,
  considerando inclusive contêineres parados.
- Projetos Traefik, n8n, Evolution, PostgreSQL e Redis aceitos sem comandos de
  mutação; o Docker falso falha se receber up/pull/stop/down/prune/restart/rm/run/create.
- Symlink em destino, ancestral gravável por terceiros, chave com opções SSH,
  senha curta ou confirmação diferente recusados.

Limites: estes testes não certificam um login real GHCR nem permissão individual
dos packages; não exercitam sshd/PAM/sudo reais nem Docker provider do Traefik.
Não validam DNS, TLS, capacidade livre, integração Coda ou recuperação de falha
de disco durante a gravação. Não foi construído novo container de infraestrutura.
O CI existente do PR fará também as validações completas da aplicação e imagens.
A VPS permanece reservada à execução futura autorizada.
