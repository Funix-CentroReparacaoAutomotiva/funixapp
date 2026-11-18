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
