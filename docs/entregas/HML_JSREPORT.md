# Renderização de PDFs na HML

A API permanece na rede interna `funix-hml_privada`. O serviço `jsreport-egress` recebe exclusivamente `POST /api/report` por HTTPS e encaminha ao endpoint fixo do jsreport. É o único serviço adicional com acesso à rede de saída. Mantenha o serviço sem portas publicadas e sem conexão à rede do Traefik.

## Configuração persistente

- Mantenha a credencial `funix-hml-render` em `/etc/funix-hml/jsreport.env`, com `root:root` e modo `0600`. Declare esse arquivo como `env_file` com `format: raw` para a API e o relay. A conta recebe leitura de `FUNIX - Orcamento` e de suas dependências.
- Na configuração base HML, defina `FUNIX_JSREPORT_ENDPOINT=https://jsreport-egress:8443/api/report`, `FUNIX_OS_JSREPORT_ENABLED=true` e `NODE_EXTRA_CA_CERTS=/tls/ca.pem` na API. Monte nela apenas o certificado público da CA dedicada. Monte no relay o certificado de servidor com SAN `DNS:jsreport-egress` e a chave privada, legível apenas pelo usuário do relay.
- Execute `node /app/hml-jsreport-egress.mjs` no relay com a imagem local etiquetada `funix-hml-api:jsreport-f7a45e7`. Use a cópia revisada de `deploy/hml-jsreport-egress.mjs` em montagem somente leitura. Preserve o ambiente de execução restrito com root filesystem somente leitura, capabilities removidas e sem privilégios adicionais. O certificado TLS próprio do relay é verificado também pelo seu healthcheck.
- Mantenha a configuração de renderização em `compose.yaml` e os arquivos protegidos em `/etc/funix-hml`. `release-simple.json` continua reservado à troca de imagens e revisão. As atualizações de aplicação devem preservar esse Compose e conferir as rotas de PDF após recriar a API.

## Aplicação e reversão

Registre as imagens e IDs existentes, confira a rede interna e faça um backup consistente do SQLite. Preserve o Compose anterior e sua configuração efetiva em diretório restrito. Aplique a configuração somente ao projeto `funix-hml`. Após recriar a API, confira os serviços, as montagens, as redes e o bloqueio HTTPS de requisições sem autenticação. Verifique a integridade e as chaves estrangeiras do SQLite.

Use um Atendimento sintético para gerar a prévia do orçamento, emitir e baixar o original e gerar a OS V1.1. Cancele o orçamento de teste e confira visualmente a marca nos downloads do orçamento e da OS. Compare os bytes armazenados dos originais antes e depois do cancelamento.

Para reverter a configuração, restaure `compose.yaml` e `release-simple.json` do backup abaixo, recrie apenas a API e remova somente o contêiner `funix-hml-jsreport-egress-1` e a rede `funix-hml_jsreport_out`. Confira saúde, autenticação e integridade. Restaure o SQLite a partir do backup apenas se houver alteração de dados que exija reversão e com a API parada.

## Instalação aplicada em 25/11/2026

- Revisão da API: `f7a45e763ef64a016533ae037639d995a4affaac`, imagem `sha256:8d9e1086c73640b75f8e4deadbae8aa439ecd9b127a3df8f25031e3adbef8ece`. Web e Gateway permaneceram nas imagens anteriores.
- Arquivos persistentes: `/opt/funix-hml/compose.yaml`, `/opt/funix-hml/release-simple.json`, `/etc/funix-hml/jsreport.env`, `/etc/funix-hml/hml-jsreport-egress.mjs` e `/etc/funix-hml/jsreport-tls/`. Nenhuma senha está no repositório. A API liga somente à rede `funix-hml_privada`; o relay liga a esta e à rede de saída própria, sem porta publicada.
- Backup SQLite consistente e arquivos de reversão: `/etc/funix-hml/backups/jsreport-20261125T114358Z/`. O primeiro ensaio, revertido automaticamente antes de iniciar o relay, também possui backup em `/etc/funix-hml/backups/jsreport-20261125T114310Z/`.
- O instalador usado está em `deploy/hml-jsreport-install.py`. É uma operação única com pré-condições da revisão antiga e não deve ser executado novamente após a instalação.
- O certificado interno foi criado com validade de 365 dias. Renove o certificado e a chave no diretório protegido antes de 25/11/2027 e recrie o relay; a API deve confiar no novo certificado ao ser recriada. Não desative a validação TLS.

Validação funcional com Atendimento exclusivamente sintético `79b8fe5d-abe1-468c-bba1-275a0f101ee3`: prévia comercial emitível de R$ 98,90; prévia PDF HTTP 200; orçamento `OR-000002` emitido e baixado; agendamento e Experiência criados; OS `OS-000001` gerada e PDF baixado; cancelamento do orçamento de teste e downloads posteriores de orçamento e OS renderizados em PDFs válidos e distintos dos originais. O relay retornou 401 sem autenticação e 400 para contrato fora da lista permitida. O Gateway retornou 401 sem autenticação. SQLite passou `PRAGMA integrity_check` e `PRAGMA foreign_key_check` após a implantação.

Os downloads cancelados foram verificados pelo formato, resposta e diferença de hashes. Não foi feita inspeção visual da marca d'água neste ensaio. Uma inspeção visual no navegador permanece recomendada na homologação.
