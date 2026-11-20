# Ensaio descartável do canal remoto

## Fronteira Linux instalada

O job adicional `linux-boundary` executa `hml_linux_boundary.py` exclusivamente
como root em GitHub-hosted Ubuntu com conta, grupo, caminhos e unidades ausentes.
Instala cópias byte a byte dos dois wrappers, sudoers e unidades versionados;
valida a regra com visudo. Testa sudo real pela conta sem privilégios, argumentos
extras, comando arbitrário, env indevido, uid/env limpos, arquivos sem escrita
pela conta e ausência de grupo/acesso ao socket Docker.

Se PID1 é systemd, testa as duas unidades com daemon real, transporte mTLS real
em loopback, propriedades efetivas, execução root do worker, início único,
falha, interrupção, Restart=no, presença de registros no journal sem divulgar
mensagens brutas, suspensão do transporte e revogação da regra sudo dedicada.
O backend root é **sintético** e não emite autorizações nem executa o atualizador.
O ensaio Docker separado continua sendo a evidência de aprovação/transação real;
estes dois testes não são uma única execução das fronteiras instaladas com SQLite.
Propriedades systemd são inspecionadas, não prova exaustiva de escape do sandbox.

Se systemd não está disponível, ainda verifica arquivos com systemd-analyze,
emite `HML_SYSTEMD_RUNTIME_UNAVAILABLE_VM_REQUIRED` e não chama isso de teste
runtime aprovado. É necessário repetir esse mesmo script e os cenários de
unidades numa VM Linux GitHub-hosted descartável com systemd PID1. Nunca usar
VPS ou runner self-hosted como substituto. O script recusa hosts já instalados.

A limpeza para e verifica as unidades antes de remover somente os arquivos e
a conta criados pelo ensaio; qualquer erro falha o job. Cancelamento abrupto
descarta o runner. Não habilita unidades no boot nem cria listener público.
Ver [reconciliação administrativa](RECONCILIATION.md) para os limites após morte
de um worker e distinção entre aceite do código e aceite operacional.

## Transação integrada existente

O job `synthetic` de `hml-maintenance-rehearsal.yml` executa
`deploy/tests/hml_docker_maintenance_cycle.py`, que incorpora
`hml_remote_chain.run_chain`. Exige runner GitHub hospedado, root, daemon Docker
vazio e ausência da instalação HML. Não executar em host compartilhado ou VPS.
Os certificados, aprovações, credencial fictícia, bancos e caminhos são gerados
no diretório temporário do ensaio; nenhum material emitido é versionado.
O job usa três runners independentes (`accepted`, `auto-restored`, `interrupted`),
um por cenário. A suíte unitária roda uma vez, no cenário `accepted`.

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
- Operação, SHA da revisão ou digest diferentes da aprovação são recusados
  antes da criação de journal. Endpoints de aprovação, recovery e rollback
  não são expostos pelo transporte.
- No cenário `auto-restored`, o adapter real instala e valida a candidata,
  incluindo migração SQLite, e só então o teste injeta `ValueError` na fronteira
  de validação. A transação oficial restaura o backup, configuração e imagens;
  o worker publica `auto_restored`, com backup, HTTPS e sentinela verificados.
- No cenário `interrupted`, o processo filho termina com `os._exit(77)` após
  a mesma instalação/validação. Isso ignora `finally` e deixa o journal em
  `installing`, sem resultado do worker. GET informa `running_or_interrupted`;
  novas aprovações e replay são bloqueados. A recuperação administrativa oficial
  restaura o estado anterior e os dados. O pedido remoto permanece incerto e
  bloqueado: o ensaio não apaga seus registros nem inventa um rearme automático.
  Esse cenário comprova a morte do processo, não o comportamento de uma unidade
  systemd instalada ou uma queda de energia do host.
- O restante do mesmo ensaio faz rollback autorizado, migração sintética
  incompatível, interrupção antes do aceite e recuperação após o aceite com
  preservação de escrita posterior. Essas falhas/recuperações são acionadas
  pela API administrativa oficial, **não por uma unidade systemd real nem por
  uma nova chamada remota de recuperação** (que não existe no contrato).

O marcador `HML_REMOTE_TLS_DISPATCH_WORKER_TRANSACTION_OK` só é emitido após
o aceite observado por GET. Os marcadores seguintes registram separadamente
rollback e recuperações; o job precisa concluir inteiro para aprovação.
Os runners de falha exigem também `HML_REMOTE_FAILURE_DATA_PRESERVED_OK`, após
conferir revisão anterior, journal restaurado, SQLite original e arquivos externos.
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

Em particular, após morte abrupta do worker, recuperar a transação não conclui
o pedido remoto. O status conserva a incerteza e impede novas operações até
reconciliação administrativa revisada. Não excluir `current.json`, journals,
aprovações ou locks para prosseguir. Esta revisão não adiciona interface de
reconciliação nem amplia permissões remotas.
