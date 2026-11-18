# FUNIX — Segurança de atualização HML: etapa 2 (componentes offline)

Estado: desenvolvimento, sem execução na VPS. A etapa 1 continua sendo a
geração de candidato por revisão (PR #262). A PR #230 documenta o healthcheck.
O CI anterior da #262 foi aprovado em 10/10 workflows, mas não inclui um
despacho manual real do novo workflow.

## Evidência de configuração instalada

Fonte: relatório do operador funix_hml_auditoria_atualizacao_resultado.txt.
A coleta somente leitura retornou AUDIT_COMPLETE e SSH_EXIT=0.
API, Web e gateway Running e healthy, sem portas no host, sem modo
privilegiado e com rootfs read-only. Rede funix-hml_privada interna, somente
membros da HML; gateway também conectado a traefik_default. As flags de
integrações identificadas estão false e não houve configuração externa
não vazia detectada. Conferir novamente na execução, inclusive novas
variáveis/funcionalidades introduzidas pela revisão candidata.

Projeto funix-hml, arquivos /opt/funix-hml/compose.yaml,
gateway.compose.yaml e release.env; arquivos de configuração e senha em
/etc/funix-hml. Release utiliza FUNIX_HML_API_IMAGE, FUNIX_HML_WEB_IMAGE e
FUNIX_HML_REVISION. Gateway e Web compartilham a imagem atualmente.
Banco /var/lib/funix-hml/app-data/funix.sqlite montado em /data, UID/GID
1000, modo 0600; diretório 0700. Tamanho observado 626688 bytes, sem
sidecars no instante da coleta. Cerca de 86,9 GB livres; dois CPUs lógicos.
A coleta não leu o conteúdo do SQLite; não demonstra integrity_check ou
compatibilidade de qualquer migração. Python SQLite observado: 3.45.1.

## Implementação offline

deploy/hml-update-safety.py contém funções sem CLI para operação real:
- verify_candidate exige manifesto com formato conhecido, identidade
  PR/SHA/run/tentativa fornecida independentemente, tags exclusivas HML,
  IDs distintos, checksum do arquivo e arquivos regulares sem symlinks.
  Não extrai ou carrega o tar, não confirma assinatura, não autentica o
  run. O caller deve verificar no GitHub que o artefato veio do workflow
  confiável, na main, run e tentativa corretos, concluído com sucesso.
- snapshot usa a API SQLite de backup consistente com inspeção de
  integridade, chaves estrangeiras e histórico de migrações, gera uma
  cópia independente de WAL em arquivo novo, modo 0600, diretório 0700.
  Não sobrescreve destinos. Para rollback o caller deve parar a API e
  impedir todos os escritores durante a cópia e atualização.
- stage_restore confere o SHA e prepara cópia validada em arquivo novo.
  Não substitui o banco ativo, não remove WAL do banco ativo. As funções
  devem rodar em diretórios privados e estáveis, fora da produção, com
  permissão controlada. Não substituem validações de caminhos do adaptador
  real responsável pela operação.

Os testes sintéticos incluem WAL, migração destrutiva simulada e recuperação
do conteúdo pré-migração em arquivo separado, rejeição de checksum errado,
destino existente e histórico inválido. Nenhum teste acessa banco real.
A execução do CI deste commit deve ser verificada antes do aceite.

## Contrato para o adaptador de atualização (pendente)

Recomenda-se separar a imagem de infraestrutura do gateway da imagem Web
de PR, mantendo o gateway fixado ao digest já validado ou em imagem HML
específica revisada. É uma proposta, não mudança na configuração vigente.
Como o gateway está na rede compartilhada, não executar código candidato
nesse contêiner. Rever a alteração controlada no Compose e dependência de
imagem com ensaio sintético antes de instalar. O processo deve continuar
restrito a código interno revisado e habilitado para homologação; a rede
interna e a ausência de portas não tornam código malicioso confiável.

O adaptador necessita:
1. Conferir proveniência do artefato e manifesto, e validar conteúdo e
   IDs das imagens efetivamente carregadas, sem sobrescrever tags
   produtivas. Somente carregar artefato confiável; não extrair tar
   arbitrário como root. Nenhum acesso da PR à chave SSH administrativa.
2. Lock exclusivo HML; recusar configuração divergente, env inesperado,
   integração externa, mount fora dos caminhos HML, projeto/redes/labels
   divergentes. Capturar e preservar release e IDs/digests anteriores.
   Não divulgar senhas, env expandido, dados ou logs sensíveis.
3. Ensaiar candidato em contêineres sintéticos, com gateway estável e
   SQLite fictício. Testar falha de pull/load, health, revisão, migração,
   interrupção, falta de espaço, bloqueio por lock, rollback parcial.
4. Antes da mudança autorizada: impedir acesso de usuários à HML durante
   a janela, parar API HML, conferir ausência de escritores e preservar
   banco (snapshot validado) e configuração. Não tocar recursos produtivos.
5. Aplicar release nova somente à API/Web HML; preservar autenticação e
   healthcheck do gateway. Testar upstreams após recriação (DNS/IP Nginx
   pode exigir reload/recriação exclusiva do gateway HML, usando imagem
   estável, sem restart do Traefik). Não aceitar HTTP inseguro.
6. Em falha: interromper os serviços HML; confirmar ausência de escritores,
   preservar banco falho para análise, validar cópia restaurada, tratar
   sidecars SQLite somente com API parada, repor UID/GID/modo 1000:1000/0600
   e release antiga, reativar somente serviços HML e validar novamente.
   A substituição real precisa de journal operacional durável e recuperação
   de interrupção; não presumir que reiniciar a imagem resolve migração.
7. Aceite exige HTTPS estrito, 401 Basic nas quatro rotas, 200 autenticado,
   revisões coerentes, gateway/API/Web healthy e integridade dos demais
   serviços. Liberar acesso para validação funcional apenas após aceite.
   Sem compose down, prune, alteração do Traefik ou produção.

Bloqueio atual: não existe adaptador Docker integrado validado. Não executar
mudanças na VPS com estes componentes. O ambiente especializado com Docker
e testes de ciclos de recuperação traz vantagem concreta nesta etapa; se
for usado Codex, limitar a esse contrato e reaproveitar os componentes,
sem merge, deploy, acesso à VPS ou dados reais.

## Ensaio integrado local do adaptador

Incremento CLI: `python3 deploy/hml-update.py ACTION --config /caminho/config.json
--operation /caminho/operacao` oferece preflight, update, recover e rollback.
As mutações exigem --authorize; rollback exige também
--discard-post-update-data. Config JSON privado contém compose, contract
(configuração normalizada revisada), database, state, credentials (JSON privado
com username/password), candidate (api/web/gateway IDs e revision), artifact_zip
e identity (artifact_id/run_id/attempt/revision/pr). Preflight não cria journal
nem carrega imagens. O fluxo update consulta procedência autenticada, valida
ZIP e docker-save, recusa colisões de tags e carrega as imagens. A validação
exige TLS estrito do hostname HML, Basic Auth, endpoints e revisões.

Estado: CLI experimental, ainda sem autorização de uso real. Faltam testes
integrados de HTTPS/Basic reais, isolamento de mounts/integrações independente
do contrato fornecido e coordenação do carregamento de imagens sob o lock.
Não executar na VPS. As pendências anteriores continuam aplicáveis quando não
explicitamente cobertas pelo incremento.

Correções posteriores: o carregamento agora é callback executado dentro do
lock global, após verificar recuperação pendente. O rollback exige que a
operação seja a ativa e que IDs/revisão instalados coincidam. Bancos falhos
ficam no diretório de cada operação. Um post-update.sqlite sem digest
confirmado no journal bloqueia recuperação para inspeção; não é presumido
completo. Compose aceita lista ordenada de arquivos e release_env explícito,
compatível com compose.yaml + gateway.compose.yaml + release.env. Credenciais
aceitam também o formato Usuario/Senha instalado. Mounts são limitados a /data
da API e arquivos somente leitura em /etc/funix-hml, e flags de integração
habilitadas bloqueiam preflight.

O teste HTTPS local usa uma CA sintética, handshake real e servidor HTTP real:
rejeita certificado não confiável, verifica Basic Auth e revisões. Não é um
teste de gateway/Traefik Docker. A CLI continua experimental: falta impedir
novas gravações durante validação com gateway ativo, validar todos os
escritores externos ao Docker e testar as políticas negativas completas.
Portanto não há comando de instalação autorizado para a VPS nesta entrega.

`hml-docker-adapter.py` conecta o coordenador a Docker Compose com projeto
fixo funix-hml, configuração normalizada comparada integralmente a um contrato
revisado, imagens por ID, gateway estável, stop direcionado e restauração do
SQLite após parada. Não tem CLI de instalação. O validador de aplicação é
injetado pelo caller; uma função vazia só é usada no ensaio sintético.

`python3 deploy/tests/hml_docker_cycle.py` exige daemon local sem contêineres,
usa python:3.12-alpine, cria SQLite fictício e três contêineres. Executa update,
alteração incompatível dos dados dentro da API, rollback e conferência do
conteúdo original. Também reconstrói o coordenador com journal em installing
para ensaiar recuperação de interrupção. Remove apenas os três contêineres
do ensaio. As redes internas sintéticas permanecem para repetição local.

O ciclo retornou DOCKER_SYNTHETIC_UPDATE_ROLLBACK_OK. Não testa migração real
do aplicativo, HTTPS, Basic Auth ou roteamento: os serviços são placeholders.
Não utilizar este adaptador na VPS: ainda faltam contrato completo de mounts,
credenciais e integrações, controle de escritores fora do Docker, coordenação
persistente entre operações interrompidas, extração/carregamento autenticado
e validador HTTPS integrado. A comparação com contrato fornecido pelo caller
não substitui sua auditoria. O fluxo de instalação real continua bloqueado.

## Incremento do coordenador transacional

`hml-update-transaction.py` implementa lock exclusivo, journal com fsync e
substituição atômica, snapshot definitivo após quiescência, rollback em falha
e recuperação explícita de operação interrompida. O journal é privado e deve
receber apenas identificadores de release, nunca credenciais. Cada operação
usa um diretório novo. O lock fica no estado global do projeto
`/var/lib/funix-hml/updater`, independente do diretório da operação.
`recover(authorized=True)` recusa atualização aceita. Para essa situação,
`rollback(authorized=True, discard_post_update_data=True)` exige reconhecimento
explícito e preserva um snapshot dos dados atuais antes de restaurar os antigos.
Recuperação é idempotente após restauração concluída.

Os testes usam um adaptador simulado e SQLite sintético real, incluindo uma
alteração de dados representando migração incompatível. Não são testes Docker.
O Docker local responde, mas ainda não foi executado um ciclo integrado nele.
O adaptador deve garantir ausência de escritores, isolamento HML, preservação
do banco falho e sidecars, restauração atômica, UID/GID e validação HTTPS.
Essas obrigações ainda não estão implementadas; este módulo não oferece CLI
de atualização real. Procedência autenticada no GitHub também permanece
pendente de integração ao adaptador. `hml-artifact-provenance.py` consulta a
API autenticada via gh, exige run manual aprovado do workflow na main e confere
o digest GitHub do ZIP baixado, identidade do artefato e SHA da PR. Não utiliza
checksum local como prova de autenticidade. Ainda falta ligar essa função à
extração segura e à operação Docker. Não utilizar o coordenador com dados da
VPS nesta etapa.

Validação adicional: Docker local executou Python/SQLite com rede desabilitada
e rootfs somente leitura, retornando integrity_check=ok. Isso é apenas um smoke
test de disponibilidade; não constitui ciclo integrado de atualização/rollback.

A validação offline do docker-save agora rejeita tags fora da HML, IDs de
config divergentes, revisões incorretas, camadas ausentes, links, caminhos
inseguros e expansão acima do limite antes de qualquer carregamento. Isso
complementa integridade; não autentica o produtor do pacote.

## Verificação independente de escritores — incremento ChatGPT

`deploy/hml-writer-guard.py` adiciona a checagem conservadora de sobreposição
de caminhos de mounts (incluindo ancestrais e descendentes) e inspeção Linux
somente leitura de descritores e mapas de memória por dispositivo/inode dos
arquivos SQLite e sidecars. Não lê dados do banco nem imprime nomes de
processos, credenciais ou conteúdos de mapas. Bloqueia também leitores, links
inesperados, inspeção incompleta e execução global sem root.

Sete testes específicos passaram no ambiente Linux do ChatGPT, com arquivos
sintéticos, processo filho real com descritor aberto e mapa simulado para
identidade alternativa. Sintaxe Python aprovada. A tentativa de varredura
global de /proc nesse ambiente retornou bloqueio por inspeção incompleta
(as permissões/isolamento local não permitem confirmar todos os processos).
Não há Docker disponível nesse ambiente, nem teste da varredura na VPS.

A checagem é observacional: não impede aberturas futuras nem substitui a
janela de manutenção, exclusividade administrativa, controle de mounts ou
o lock do coordenador. Não é prova absoluta de ausência de escritores.
Antes de ativá-la no adaptador, testar em host Linux isolado com acesso
integral a /proc e Docker local; executar após quiescência e antes de backup
e substituição do banco, sem revelar metadados de outros serviços. Testar
montagens sobrepostas, namespaces, sidecars e falhas de permissão. Se houver
bloqueio, não executar operação destrutiva; não enfraquecer a checagem apenas
para passar o teste. Conservar o update bloqueado até aceite integrado da
manutenção e recuperação. Nenhuma alteração foi aplicada à VPS.

## Janela de manutenção — regra de gateway testada pelo ChatGPT

`deploy/hml-maintenance.py` fornece bloco server restritivo de Nginx e
credencial aleatória exclusiva da operação (não reutilizar senha comum).
Apenas GET exato em /, /api/ready, /release.json e /healthz é encaminhado,
com Basic Auth de manutenção; demais métodos, rotas e query strings ficam
bloqueados. Não encaminha corpo, cookies, Authorization ou cabeçalhos de
clientes; ignora X-Accel-Redirect e oculta Set-Cookie. O GET permitido
precisa ser revisado como diagnóstico sem gravação de usuário na revisão
candidata. Essa regra não impede writes internos da própria API.

Quatro testes passaram no ambiente do ChatGPT, incluindo três testes HTTP
com Nginx 1.26.3 real e upstream Python sintético em loopback. Nginx -t
passou; senhas comuns/ausentes/incorretas rejeitadas, credencial temporária
aceita nas quatro rotas, métodos e caminhos não permitidos não chegam ao
upstream (inclusive variantes de URI), cabeçalhos e corpo descartados.
O teste pula a parte Nginx onde o binário não existir. Não houve Docker,
HTTPS neste ensaio, nem acesso à VPS. O bloco server não é a configuração
completa de Nginx da instalação.

Integração pendente (não habilitar update antes do aceite):
- Após lock e journal durável, parar somente gateway HML e confirmar API
  parada e ausência de escritores. Assegurar que arquivos de manutenção
  e credencial privada sejam persistidos por operação; jamais alterar
  os arquivos originais de autenticação/configuração. Usar override com
  os dois bind mounts específicos e somente leitura, validar configuração
  completa e imagem estável; garantir permissões do UID/GID do Nginx.
- Manter o gateway restrito na atualização, recuperação e rollback; só
  validar com credencial de manutenção. Confirmar HTTPS estrito, 401
  para credencial normal e healthcheck sem auth, 200 correto nas quatro
  rotas, rejeição de escrita, revisão e IDs. Testar gateway real, não só
  placeholders. Conferir mounts tmpfs legítimos /tmp e demais restrições
  independentemente do contrato. A verificação de escritores deve rodar
  após a parada e imediatamente antes de backup/restauração.
- Distinguir no journal fase de release aceita mas ainda em manutenção:
  persistir aceite ANTES de reabrir acesso comum. Em interrupção após esse
  aceite, retomar apenas a abertura do gateway, nunca restaurar backup
  automaticamente. Se abertura falhar, manter indisponível/restrito e
  exigir recuperação específica, sem perda de dados pós-aceite.
- Confirmar no Docker isolado retorno seguro ao acesso normal, falhas e
  interrupções nos pontos de troca, autenticação e persistência do gate;
  os arquivos originais e o Traefik não devem ser modificados.

## Coordenação persistente da janela de manutenção — incremento ChatGPT

O coordenador agora oferece modo explícito `maintenance=True` (experimental;
não é utilizado pela CLI real). Exige do adaptador `enter_maintenance()`,
`assert_installed(release)` e `open_access(release)` além do contrato existente.
O modo é registrado no journal e não pode ser alterado na recuperação.
O adaptador deve garantir que instalar e validar ocorram exclusivamente
com o gateway fechado/restrito, inclusive após falhas; as operações de
fechamento e abertura devem ser idempotentes.

Depois de validar a release, o coordenador grava duravelmente
`accepted_pending_open` antes de reabrir o acesso normal. Falhas antes desse
aceite continuam sujeitas ao rollback; falhas na abertura não provocam
restauração automática. A recuperação dessa fase verifica a release
instalada e retenta somente a abertura, preservando possíveis gravações
posteriores. O mesmo ocorre para `restored_pending_open` após rollback.
Enquanto a fase não for terminal, novas atualizações são recusadas. A
recuperação do modo manutenção exige o journal ativo do projeto.

Sete novos casos de teste usam adaptador simulado e SQLite sintético real:
aceite antes da abertura, interrupção após abrir, bloqueio de nova
operação, recuperação pré-aceite, rollback com backup pós-atualização e
interrupção ao reabrir, modo incorreto/contrato incompleto e divergência de
release. Os testes devem ser executados no CI antes de considerar esta
alteração aprovada; não são testes Docker/HTTPS. A CLI real continua
bloqueada. Falta ligar os hooks ao adaptador Docker, implementar e validar
a troca efetiva do gateway, aplicar a inspeção host de escritores e
testar todo o ciclo integrado. Não utilizar na VPS antes do aceite.
