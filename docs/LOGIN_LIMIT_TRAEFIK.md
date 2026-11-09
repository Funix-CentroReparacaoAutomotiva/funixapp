# FUNIX — Proteção do login atrás de Traefik

**Escopo:** somente identidade do cliente no limite de tentativas de login. Não altera a senha, sessões, Coda, WhatsApp, banco, preços ou deploy.

## Problema e correção

A API recebe TCP da rede Docker através do Traefik. O limite antigo usa apenas `req.socket.remoteAddress`: se todas as conexões vierem do mesmo proxy, oito senhas incorretas bloqueiam todos os operadores pelo mesmo intervalo.

O novo limitador usa o endereço TCP por padrão. Somente se o TCP vier de **um IP exato** configurado em `FUNIX_LOGIN_TRUSTED_PROXY_IPS`, utiliza o **último endereço válido de `X-Forwarded-For`**, que deve ser o hop mais próximo adicionado pelo proxy de borda confiável. Cabeçalho ausente, malformado ou excessivo recai no limite do peer. Nunca usar o primeiro elemento fornecido pelo cliente como identidade confiável. A configuração recusa CIDR e entradas inválidas; a quantidade de buckets em memória é limitada.

## Ativação em produção — etapa separada, não autorizada pela PR

1. No host, confirmar o IP do Traefik **visto pela API**, por observação controlada sem divulgar IP de clientes ou informações de ambiente. Confirmar que a topologia do Docker não permite conexão direta de origem não confiável que possa reivindicar esse IP. O endereço pode variar se o contêiner/rede for recriado.
2. Conferir a configuração efetiva da entrada `websecure`: confirmar que Traefik não confia cegamente nos cabeçalhos `X-Forwarded-For` enviados por visitantes (sem `forwardedHeaders.insecure=true` nem trust amplo de redes não verificadas). Confirmar que Traefik escreve ou saneia o endereço do cliente recebido.
3. Somente depois definir no arquivo privado `/etc/funix/runtime.env` o IP exato de **cada proxy realmente confiável**: `FUNIX_LOGIN_TRUSTED_PROXY_IPS=<IP-VERIFICADO>`. Nunca editar arquivos de configuração por meio do repositório.
4. Publicar uma versão autorizada, verificar o login real e simular tentativas incorretas apenas em teste isolado. Em caso de inconsistência, remover a variável e usar o comportamento anterior; nenhuma migração ou rollback de banco é necessário.

**Limitação:** os testes sintéticos não comprovam o encaminhamento real de IP do Traefik instalado. Sem inspeção da rede e dos cabeçalhos efetivos, não declarar mitigação produtiva. O limite atual continua em oito tentativas e quinze minutos por identidade, com reinício de contadores após senha correta.
