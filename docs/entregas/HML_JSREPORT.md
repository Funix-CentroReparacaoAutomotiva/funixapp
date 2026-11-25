# Renderização de PDFs na HML

A API permanece na rede interna `funix-hml_privada`. O serviço `jsreport-egress` recebe exclusivamente `POST /api/report` por HTTPS e encaminha ao endpoint fixo do jsreport. É o único serviço adicional com acesso à rede de saída. Mantenha o serviço sem portas publicadas e sem conexão à rede do Traefik.

## Configuração persistente

- Mantenha a credencial `funix-hml-render` em `/etc/funix-hml/jsreport.env`, com `root:root` e modo `0600`. Declare esse arquivo como `env_file` com `format: raw` para a API e o relay. A conta recebe leitura de `FUNIX - Orcamento` e de suas dependências.
- Na configuração base HML, defina `FUNIX_JSREPORT_ENDPOINT=https://jsreport-egress:8443/api/report`, `FUNIX_OS_JSREPORT_ENABLED=true` e `NODE_EXTRA_CA_CERTS=/tls/ca.pem` na API. Monte nela apenas o certificado público da CA dedicada. Monte no relay o certificado de servidor com SAN `DNS:jsreport-egress` e a chave privada, legível apenas pelo usuário do relay.
- Execute `node /app/hml-jsreport-egress.mjs` no relay com a imagem Node já usada pela API. Use a cópia revisada de `deploy/hml-jsreport-egress.mjs` em montagem somente leitura. Preserve o ambiente de execução restrito com root filesystem somente leitura, capabilities removidas e sem privilégios adicionais.
- Mantenha a configuração de renderização em `compose.yaml` e os arquivos protegidos em `/etc/funix-hml`. `release-simple.json` continua reservado à troca de imagens e revisão. As atualizações de aplicação devem preservar esse Compose e conferir as rotas de PDF após recriar a API.

## Aplicação e reversão

Registre as imagens e IDs existentes, confira a rede interna e faça um backup consistente do SQLite. Preserve o Compose anterior e sua configuração efetiva em diretório restrito. Aplique a configuração somente ao projeto `funix-hml`. Após recriar a API, confira os serviços, as montagens, as redes e o bloqueio HTTPS de requisições sem autenticação. Verifique a integridade e as chaves estrangeiras do SQLite.

Use um Atendimento sintético para gerar a prévia do orçamento, emitir e baixar o original e gerar a OS V1.1. Cancele o orçamento de teste e confira visualmente a marca nos downloads do orçamento e da OS. Compare os bytes armazenados dos originais antes e depois do cancelamento.

Para reverter a configuração, restaure o Compose e o override anteriores, recrie a API na imagem anterior e remova o serviço `jsreport-egress` de HML. Confira saúde, autenticação e integridade. Restaure o SQLite a partir do backup apenas se houver alteração de dados que exija reversão e com a API parada.
