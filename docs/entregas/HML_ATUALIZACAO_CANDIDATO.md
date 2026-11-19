# FUNIX — fluxo de candidatos para homologação (etapa 1)

Estado: proposta em PR separada, não implantada. A HML existente permanece
na revisão anteriormente validada; esta PR não altera a VPS, Traefik,
healthcheck instalado, Compose de produção, packages GHCR ou workflow
produtivo. Referência do gateway: PR #230.

## Objetivo e limite

A etapa 1 cria um workflow manual, **FUNIX - Homologacao (candidato)**,
que seleciona o SHA exato de uma PR revisada, retesta e constrói as duas
imagens num runner GitHub hospedado, sem comunicação com a VPS. Por
decisão de segurança e simplicidade inicial, o transporte é um artefato
privado do Actions, não publicação GHCR. Nenhum job tem packages:write,
ambiente production, secrets de produção ou chave SSH. Isso evita
conceder escrita em packages produtivos a um build de código de PR.

O arquivo de workflow precisa estar na main antes de aparecer como
despacho manual. A integração desta PR exige autorização separada.
Não executar uma versão do workflow de outra branch. O guard é defesa
adicional, não uma barreira contra alguém autorizado a editar todos os
workflows. O repositório e permissões de colaboradores devem continuar
restritos. Não conceder aprovação automática a código de terceiros.

## Como usar após revisão e integração autorizada

1. Revisar o diff e a procedência da PR candidata (incluindo alterações
   de workflows, Dockerfile, dependências e scripts). PR interna pode
   estar draft para homologação; fork, PR fechada ou alvo diferente de
   main é bloqueado.
2. Confirmar os checks na revisão exata. Copiar o SHA de 40 caracteres
   do HEAD, não o número da PR ou nome da branch como revisão.
3. GitHub Actions → FUNIX - Homologacao (candidato) → Run workflow,
   branch main. Informar número da PR, SHA e marcar a autorização de
   build isolado. Não use o FUNIX CI and delivery para testar uma PR.
4. O seletor consulta a PR e os runs de pull_request, exige as dez
   rotinas incondicionais atualmente presentes em main (ver
   deploy/hml-candidate.py) e sucesso do run mais recente de cada
   workflow relacionado encontrado. Uma listagem incompleta, ausência
   de associação inequívoca ou estado não aprovado bloqueia. Se os
   workflows forem alterados, revisar a lista obrigatória. Nenhuma
   aprovação de GitHub equivale à aprovação funcional da direção.
5. O runner de build faz checkout pelo SHA exato, sem persistir a
   credencial, executa npm run check e regressões de implantação,
   constrói as imagens e roda deploy/test-containers.sh com dados
   sintéticos e revisão candidata. A suíte existente testa contratos
   da imagem, não a configuração real da HML.
6. No run aprovado, baixar o artefato funix-hml-<SHA>-<tentativa>.
   Retenção de três dias; minutos/armazenamento seguem a cota GitHub
   existente. Não há nova assinatura ou serviço contratado.

O artefato contém images.tar.gz (API + Web com tags funix-hml-api e
funix-hml-web no SHA) e manifest.json (SHA, PR, run, tentativa, IDs locais
das imagens e SHA-256 do arquivo). O ID de imagem não é digest GHCR.
O hash verifica integridade de transporte, não assinatura/autenticidade
frente a um build malicioso. Conferir procedência do run e revisar
novamente a PR antes de instalar. Não executar imagens desconhecidas.

## Próxima etapa — entrega restrita na VPS, ainda bloqueada

A etapa 2 será uma automação separada para consumir somente um artefato
revisado, conferir manifesto e IDs, validar exclusivamente funix-hml,
armazenamento, integrações desabilitadas, healthcheck e revisões, criar
backup consistente do SQLite HML e trocar somente API/Web/gateway,
preservando as configurações instaladas e a senha. Exige testes com
migrações e reversão sintética e autorização específica. Se uma migração
não permitir retorno de imagem, será necessário restaurar backup da
HML com a API parada. O gateway usa a imagem Web; deve manter o
healthcheck 401 e os upstreams exclusivos ao atualizar. Validar TLS,
Basic Auth, revisões e acesso funcional. Não compartilhar a chave root
do Windows, não instalar runner self-hosted na VPS, não conceder Docker
socket ou sudo genérico ao GitHub. Uma futura operação remota
automatizada necessita identidade e comando restritos à HML, isolados
dos recursos produtivos e revisão profissional de segurança.

Até essa entrega, não carregar nem iniciar o artefato na VPS.
A produção permanece sob o fluxo existente e autorização independente.
