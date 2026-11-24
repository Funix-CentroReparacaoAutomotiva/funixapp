# FUNIX — publicação sob demanda do mapa da Central de Orquestração

**Fonte lida pelo painel HML já implantado:**
`painel-publicado:docs/design/painel-orquestracao/snapshot.json`.

Esta branch é o canal separado de **dados públicos**. Nenhum commit nela
implanta software na VPS; a Web da HML consulta o arquivo pela API pública
do GitHub somente quando o usuário clica em **Atualizar**.

**Instruções operacionais para ChatGPT e sessões especializadas:** [AGENTS.md](./AGENTS.md). Este documento resume o canal de publicação; o guia define responsabilidades, provas e critérios de aceite.

## Procedimento do ChatGPT sob solicitação da direção

1. Consultar as issues, PRs e evidências técnicas existentes. Não inferir
   trabalho em execução, conclusão ou implantação apenas porque uma issue
   está aberta ou uma PR foi integrada.
2. Preparar `snapshot.json` na branch de proposta. Manter o contrato
   `schemaVersion: 1`, `repository: Funix-CentroReparacaoAutomotiva/funixapp`,
   URLs correspondentes a issues/PRs reais e nenhum dado confidencial.
3. Alterar **`snapshotId` em toda nova publicação** e registrar
   `publishedAt` no horário de publicação. Não reutilizar IDs de versões.
   Para status material: evidência, justificativa e data. Para bloqueio,
   descrição explícita do bloqueio.
4. Validar a estrutura, revisar diff e obter a aprovação apropriada. Pedido explícito de publicação de dados dentro do escopo já constitui autorização da operação; não implica merge de software/deploy.
   Preferir PR específica apontando para `painel-publicado`.
5. Integrar a PR aprovada em `painel-publicado`. Isso publica **dados**,
   não cria deploy. Não executar workflow de implantação da HML.
6. No painel, clicar **Atualizar**: versão igual mantém cards; versão nova
   válida substitui; falha conserva o último mapa exibido.

Nenhuma rotina agendada ou agente autônomo atualiza esta branch. O painel é flexível; ChatGPT faz a curadoria de projetos, frentes, ideias e demandas sem cadastro manual pela direção. Ver #347 e roadmap v0.3 (#354). Links de chats privados e informações confidenciais permanecem em fonte privada autorizada.
A API pública GitHub pode limitar ou ficar indisponível; o painel deve
informar o problema sem inventar progresso.

**Atenção:** a proteção Basic Auth do painel HML não torna este arquivo
privado; tudo aqui pode ser visto no repositório público.
