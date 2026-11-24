# FUNIX — operação HML simplificada

**Vigente desde 24/11/2026, por decisão expressa da direção.** Substitui os manuais de recuperação, migração e reconciliação do controlador anterior. A FUNIX precisa de um ERP funcional, não de uma plataforma própria de atualização.

## Estado verificado

- HML: https://hml.funix.com.br. Projeto Docker Compose `funix-hml`, serviços API, Web e Gateway. O transporte mTLS legado está intencionalmente desativado. Não reativar, reparar journals ou reconciliar o registro antigo. #330 e #346 foram encerradas.
- Execução n8n [48345](https://n8n-eez8.srv2060217.hstgr.cloud/workflow/2ay7vrShi3PKN6Tr/executions/48345): atualização de `54b60d98b6c39ff0dc8ada0f7daa60bcf6cf2325` para `20a1a1561223a00ba4aec6290b55ddd9c0b52696`, imagens verificadas pelo conteúdo, backup SQLite, HTTPS, integridade final e contêineres externos inalterados. Respostas 404 transitórias durante a convergência do gateway não impediram o aceite. Execução 48349 confirmou três serviços saudáveis.
- Acesso: [workflow administrativo manual no n8n](https://n8n-eez8.srv2060217.hstgr.cloud/workflow/2ay7vrShi3PKN6Tr), credencial `FUNIX - VPS Administrativo`. Não publicar webhook nem aceitar comandos provenientes de entradas externas. Conferir configuração e autorização antes de executar. O acesso atual é root; a configuração permanente com privilégios controlados ainda está pendente. Não registrar segredos em código, chat ou logs.

## Fluxo operacional

1. Selecionar a revisão autorizada, revisar alterações e confirmar CI da revisão exata. Gerar imagens API/Web (ou somente Web quando o escopo é o painel) por processo confiável. O workflow **FUNIX - Homologacao (candidato)** ainda permite build isolado de PR revisada e artefato privado. A obtenção de novos artefatos via acesso conectado ainda deve ser comprovada; não afirmar automação completa. Não acionar o workflow legado de assinatura.
2. Obter o pacote por canal autenticado. Conferir procedência, digest e conteúdo das imagens; diferenças de ID entre classic Docker e containerd não são, isoladamente, corrupção. Reutilizar `deploy/hml-image-identity.py` quando aplicável. Não usar apenas labels como prova de identidade.
3. Consultar o ambiente real e confirmar escopo: arquivos `/opt/funix-hml/compose.yaml`, `gateway.compose.yaml`, `release.env`, `release-simple.json`; banco `/var/lib/funix-hml/app-data/funix.sqlite`. Usar sempre projeto `funix-hml`, imagens fixadas e o override `release-simple.json`. Manter redes e montagens HML, integrações produtivas desativadas, autenticação e HTTPS. Não modificar Traefik global, produção ou outros projetos.
4. Após autorização aplicável, preservar release anterior e backup SQLite consistente se API/banco puderem mudar; executar somente as operações Compose necessárias. Para painel Web-only, preservar API, banco e configurações não relacionadas; verificar a revisão Web própria. Não restaurar banco em uma simples troca Web.
5. Aguardar convergência por prazo limitado: 404/502/503/504 transitórios durante recriação não comprovam falha definitiva. Validar TLS, ausência de acesso sem autenticação, status de saúde, revisão esperada, imagens e rotas funcionais relevantes. Acesso indevido ou erro de TLS não deve ser aceito. Verificar integridade SQLite quando a API/banco forem afetados e confirmar que contêineres externos não mudaram.
6. Se falhar, identificar etapa e resposta efetiva, retornar à release anterior quando necessário e verificar o resultado. Não repetir cegamente a intervenção nem iniciar recovery do controlador legado. Se a HML contém apenas dados sintéticos e a direção autoriza descarte, reconstrução simples pode ser preferível.

Exemplo de consulta, não de implantação automática:

```sh
docker compose -p funix-hml --env-file /opt/funix-hml/release.env \
  -f /opt/funix-hml/compose.yaml -f /opt/funix-hml/gateway.compose.yaml \
  -f /opt/funix-hml/release-simple.json ps
```

## Limites e aceite

O fluxo já foi comprovado com imagens previamente disponíveis na VPS, não com um novo artefato transferido automaticamente. Não depender de #330 ou #346 para publicar uma nova revisão. A direção autoriza cada intervenção relevante conforme escopo, sem novo controlador ou aprovação técnica encadeada. Produção requer autorização específica e preservação dos dados reais. Preferir operações pelo ChatGPT/n8n, sem pedir ao proprietário terminal ou scripts de rotina.

A infraestrutura legada e seus testes podem permanecer no repositório até limpeza específica; não são instruções operacionais vigentes. Não há exigência de preservar seus dados de teste nem de concluir seus journals. Não remover automaticamente recursos compartilhados. A publicação de uma nova revisão somente se conclui após validação real, não por CI ou status n8n isolado.
