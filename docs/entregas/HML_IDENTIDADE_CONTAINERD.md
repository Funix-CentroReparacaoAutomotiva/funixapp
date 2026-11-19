# Identidade criptográfica das imagens HML

Correção sobre main d53894a, para revisão antes de merge/deploy.

O manifesto autenticado continua vinculando cada imagem ao SHA-256 de sua
configuração. O ID exibido por Docker/containerd pode representar outro objeto
e não é usado como prova substituta. Antes de aceitar uma tag já existente e
depois de docker load, exportamos somente a imagem selecionada com docker
image save, em diretório temporário privado. Conferimos seleção inequívoca,
digest exato dos bytes da configuração e SHA-256 de cada camada descomprimida
contra os diff_ids dessa configuração. A configuração autenticada também
vincula plataforma, parâmetros e revisão; label isolada nunca autoriza aceite.

A tag é resolvida uma única vez, antes da exportação. docker image save recebe
o ID imutável capturado, não a tag. O ID retornado é exatamente esse ID cujo
conteúdo foi validado; nenhuma nova resolução de tag ocorre após exportar.
Uma troca concorrente da tag não pode redirecionar a exportação nem o retorno.

Os três skips locais são os métodos NginxTest em test_hml_maintenance.py,
condicionados à presença do executável nginx no host. Não indicam falha de
identidade; o workflow sintético deve executar o contrato de manutenção no
ambiente Docker/Nginx próprio. Skips locais não substituem o aceite do CI.

Após a verificação, o candidato em memória recebe o ID local inspecionado para
uso no journal, Compose e validação dos contêineres. O manifesto/pacote e a
configuração privada original não são reescritos. Carregamento e verificação
continuam sob o lock global existente. Não remover o arquivo lock: sua presença
não indica posse; exclusão pode criar dois locks independentes. Operação
pendente continua exigindo recuperação pelo journal.

Nenhuma alteração em produção, Traefik, daemon ou storage global é necessária.
Há custo temporário de disco para exportar uma imagem de cada vez. Exportação
ou formato incompatível falham fechados; não há fallback para tag/label.

Testes cobrem IDs exibidos iguais/divergentes, configuração incompatível mesmo
com mesma revisão e camada adulterada com configuração intacta. O teste local
com Docker exporta e valida python:3.12-alpine sem executar ou retaggear imagem.
O lock da VPS não foi consultado: este ambiente não dispõe da chave SSH local
informada anteriormente. Nenhum lock foi removido. Essa conferência e o ensaio
das duas imagens reais no Docker 29/containerd continuam necessários antes do
deploy autorizado. O diagnóstico do PO não foi repetido.
