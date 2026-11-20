# Ensaio descartável do canal remoto

O job `synthetic` de `hml-maintenance-rehearsal.yml` executa
`deploy/tests/hml_docker_maintenance_cycle.py`, que incorpora
`hml_remote_chain.run_chain`. Exige runner GitHub hospedado, root, daemon Docker
vazio e ausência da instalação HML. Não executar em host compartilhado ou VPS.
Os certificados, aprovações, credencial fictícia, bancos e caminhos são gerados
no diretório temporário do ensaio; nenhum material emitido é versionado.

## Fronteiras exercitadas

| Fronteira | Implementação utilizada |
| --- | --- |
| HTTPS mTLS, CA, fingerprint e origem | Servidor `transport.py` real, conexões TLS locais reais |
| Despacho, aprovação independente, expiração e consumo único | `rootctl.py` real, arquivos privados sintéticos |
| Worker e vínculo com predecessor/configuração/ZIP | `rootctl.worker()` real em processo filho |
| Coordenador e atualizador | `execute_prepared` e transação oficial reais |
| Imagens, manutenção, HTTPS/Basic Auth, revisões, backup | Docker/Nginx/TLS/SQLite reais e sintéticos do ensaio existente |
| Preservação externa | Contêiner sentinela sem rede: ID, início e reinícios verificados |
| sudo e systemd | Substituição explícita das chamadas exatas; nenhum serviço do host é instalado |
| Bootstrap e escopo de caminhos | Módulo confiável carregado do checkout e caminhos temporários injetados |
| Metadados GitHub | Respostas sintéticas: não autentica um artefato publicado real |

As chamadas sudo aceitam somente os dois argumentos de wrapper esperados pelo
transporte e invocam as funções reais correspondentes. Isso **não executa os
wrappers shell, o parser sudoers, a troca de usuário, o gerenciamento da unidade
ou o sandbox systemd**. A chamada de início da unidade é registrada pelo caminho
simulado; o ensaio inicia explicitamente um processo filho para executar o worker,
com prazo máximo. O processo filho herda as ligações sintéticas do teste.

## Asserções

- Ausência/expiração/reutilização da aprovação e formato indevido são rejeitados.
- CA não confiável, fingerprint e origem incorretos não alcançam o despacho.
- Alterações de predecessor, ZIP ou configuração depois da aprovação bloqueiam
  o worker antes de criar journal de atualização.
- A resposta de um POST é descartada propositalmente. O estado é reconciliado
  por GET; outro POST com a mesma aprovação é rejeitado.
- O worker aceita uma atualização real e o GET final expõe o journal aceito.
- O restante do mesmo ensaio faz rollback autorizado, migração sintética
  incompatível, interrupção antes do aceite e recuperação após o aceite com
  preservação de escrita posterior. Essas falhas/recuperações são acionadas
  pela API administrativa oficial, **não por uma unidade systemd real nem por
  uma nova chamada remota de recuperação** (que não existe no contrato).

O marcador `HML_REMOTE_TLS_DISPATCH_WORKER_TRANSACTION_OK` só é emitido após
o aceite observado por GET. Os marcadores seguintes registram separadamente
rollback e recuperações; o job precisa concluir inteiro para aprovação.
O encerramento remove a sentinela e os recursos específicos do ensaio; falha de
limpeza falha o job. O runner hospedado é descartado inclusive em cancelamento.

## Limite operacional

Este ensaio não libera instalação/migração operacional. Continua pendente, em
ambiente descartável com instalação real dos usuários, sudoers e unidades, a
verificação de negação de comandos extras, permissões efetivas, início/reinício
e interrupção pelo systemd e restrições do sandbox. Também não valida Windows
em execução, CA real, n8n, firewall ou configuração da VPS. O CI analisa a sintaxe
PowerShell separadamente. Nenhum desses limites deve ser apresentado como
validação concluída; implantação exige revisão e autorização separadas.
