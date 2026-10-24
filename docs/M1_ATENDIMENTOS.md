# FUNIX V1.0 — primeiro subincremento M1

Data: 24/10/2026. Desenvolvimento local autorizado pelo CTO; sem push remoto, deploy ou alteração produtiva. O restante de M1 e os marcos M2/M3/M4 continuam pendentes de implementação e revisão.

## Diagnóstico e mudanças necessárias

Base de origem inspecionada: conteúdo idêntico à main `d0a70d2` (merge da preparação Hostinger). Havia interface React/TypeScript/Vite baseada na V20, autenticação Node e adaptador Coda somente leitura. Não havia banco comercial, migrações ou comandos de Atendimento. Os contratos anteriores usavam IDs/DTOs Coda e áreas operacionais incompatíveis com V1.0.

Foram reaproveitados shell de 520 px no desktop, responsividade, cores, cards, Quadro/Lista, colapso, retorno, SVG de referência, helper HTTP e autenticação. A API ativa passou a usar SQLite; os caminhos de dados do frontend foram adaptados aos IDs próprios. Veículos/Experiências e consultas ao Coda foram retirados da operação do MVP. Chat e IA permanecem visualmente presentes e explicitamente indisponíveis.

## Acesso às fontes confirmado

Os 20 originais recebidos foram preservados sem alterações em `especificacao-v1.0/originais/`; hashes em `FONTES.json`. Incluem V1.0, 38 respostas, V0.9 completa com 144/144 avaliações aprovadas, V20, hierarquia V2 e institucionais 00–10. A V20 recebida é byte a byte idêntica à referência anterior do repositório.

Constatação estrutural da árvore V2: 322 nós de peça, 163 códigos físicos não vazios, 23 folhas sem código e 123 ações Ambos. O corpo da especificação cita 164 códigos em um trecho, enquanto o apêndice e o JSON contam 163. Essa divergência foi registrada; não bloqueia Atendimento e não foi resolvida inventando catálogo. A árvore continua somente referência proposta, sem código comercial de peças implementado.

O marcador legível de origem do Atendimento ainda não teve string escolhida. Este subincremento usa UUID técnico estável e não inventa prefixo comercial ou nomenclatura Coda. A escolha deve acontecer antes de documentos/identificação definitiva.

## Funcionamento entregue

- Criar manualmente com telefone; opcionais textuais: nome, veículo informado, marca, modelo, placa, motivo e observações.
- Aceitar contatos repetidos em Atendimentos distintos e preservar UUID ao editar telefone/placa.
- Persistir em arquivo SQLite, pesquisar por nome/telefone/placa/modelo/ID, paginar, abrir e editar.
- Salvar explicitamente, indicar erro/sucesso real, preservar formulário em falha e avisar antes de abandonar edição não salva.
- Exibir cabeçalho e detalhes somente do Atendimento selecionado, sem herdar dados do anterior durante carregamento.
- Mostrar as seis fases V1.0 e permitir mudança manual no editor. Recusa explícita e motivo necessários para Rejeitados; sem regra de avanço temporal.
- Retirar completamente a aba Veículos e manter rotas operacionais sem acesso ativo a dados.
- Manter Chat, IA global/contextual, diagnóstico, seleção de mapa e orçamento indisponíveis. Não há mensagens, IA ou registros fictícios na execução normal.

“Reabrir” aqui significa localizar/abrir novamente o Atendimento salvo, inclusive depois de reiniciar o aplicativo. Não significa reabrir OS/Experiência ou executar uma regra operacional.

## Banco e operações

Node 24 `node:sqlite`; conexão local sem outro servidor, ORM ou banco externo. Arquivos: `server/database.ts`, `server/migrations.ts`, `server/atendimentos.ts`, `server/backup.ts`. A migração SQL inicial é executada em transação e registrada em `schema_migrations`. Banco desconhecido ou de versão futura não é apagado/reinicializado silenciosamente.

A tabela `atendimentos` guarda UUID, campos livres, fase, recusa/motivo, datas, revisão técnica e campos derivados de busca/normalização. Não contém FKs de cliente/veículo/Coda, orçamento, catálogo ou OS. Datas UTC; apresentação em São Paulo. Telefone não é UNIQUE. Arquivo com modo 0600 e novos diretórios 0700; consultas parametrizadas e atualização condicional pela revisão.

Desenvolvimento: `FUNIX_DATABASE_PATH=.runtime/funix.sqlite`. Em produção, caminho de arquivo é obrigatório e memória é recusada; ainda será necessário autorizar/configurar volume persistente. **O Compose não foi alterado nem deve receber esta versão sem esse preparo posterior.**

Contrato HTTP detalhado em `API.md`: GET/POST `/api/atendimentos`, GET/PATCH `/api/atendimentos/:id`. A sessão herdada é exigida e as escritas validam origem. Não há DELETE de Atendimento. Adaptador Coda continua isolado para preservação de código, sem instanciação pelo servidor; antigos endpoints operacionais retornam indisponibilidade.

Backup consistente: `npm run db:backup -- .runtime/backups/nome-novo.sqlite`. Origem existente, destino novo, leitura da origem sem migração, backup SQLite e permissão restrita. Restauração manual com API parada; não copiar sobre banco aberto. Testes não criam registros no banco normal do desenvolvedor.

## Validação

| Verificação executada | Resultado |
|---|---|
| `npm run check` | Build frontend, TypeScript frontend/backend, testes Node e lint sem erros; quatro avisos preexistentes de efeitos em React |
| Suíte final Node | **21 testes, 21 passaram**: persistência real, dois processos independentes, opcionais, telefone mínimo/duplicado, busca, revisão 409, recusa, autenticação/origem, limites de corpo, backup/restauração e bloqueio de banco em memória em produção |
| `python tests/browser/m1_atendimentos.py` | **19 grupos de cenários passaram**, Chromium desktop 1440×960 e celular 390×844, API real e arquivo SQLite temporário |
| `python3 -m unittest discover -s deploy/tests -v` | **7 testes passaram**, mantendo limites dos comandos de implantação/rollback anteriores; somente simulação local |
| Docker targets API e web | Ambas imagens construídas localmente sem alterar Dockerfile; Node 24, migrações e novo frontend empacotados |
| `bash deploy/test-containers.sh` | Smoke passou em contêineres locais descartáveis, não root, readonly, sem rede externa: autenticação HTTPS, SQLite, criar/consultar, corpo excedente 413, ERP indisponível, SPA e assets |
| `git diff --check` e integridade | Sem erros de whitespace; SHA-256 dos 20 originais preservado; Compose, Dockerfile, workflow e scripts produtivos não alterados |

O teste de navegador comprovou criar somente com telefone, completar opcionais, salvar, buscar por nome/placa/telefone, abrir dois Atendimentos com cabeçalhos coerentes, retorno contextual, recusa manual, edição móvel, recarga e recuperação após parar/reiniciar API e iniciar um navegador inteiramente novo. Não houve requisições externas do navegador nem chamadas às APIs Coda legadas. Para testar recuperação, só um PATCH 503 e um GET atrasado foram injetados; os demais caminhos usaram o backend real. O conflito 409 foi provocado por duas revisões reais no SQLite.

Evidências sintéticas: [relatório JSON](evidencias/m1-browser-resultados.json), [Funil desktop](evidencias/m1-desktop-funil-sintetico.png), [Atendimento móvel](evidencias/m1-mobile-atendimento-sintetico.png) e [editor móvel](evidencias/m1-mobile-edicao-sintetica.png). O runner remove banco temporário e encerra seus próprios processos. Nenhum registro foi semeado no banco normal do aplicativo.

Neste sandbox Chromium/sockets/Docker exigem acesso ampliado ao ambiente local; os testes foram executados com essa permissão, sem acesso à VPS. O teste de reinício por subprocessos usa relatórios temporários para funcionar também quando stdout de filhos não é capturado pelo runner. A suíte de sucesso não substitui banco por mocks.

Não houve push; o CI remoto não recebeu esta versão. Não se declara homologação produtiva ou conclusão do M1 completo. A edição adicional em `deploy/test-containers.sh` é apenas adaptação de teste ao novo contrato e banco descartável em `/tmp`; não instala ou modifica serviços reais.

## Limites e próximo passo, somente após revisão

Este é M1.1, não o M1 completo. Não há catálogo próprio, hierarquia saneada, cálculo de preço/energia, versão A/B/C, PDF, envio ERP, WhatsApp ou IA. A próxima entrega M1 é preparar os contratos/carga e manutenção simples dos catálogos fornecidos pela direção, antes de composição e motor. Sem iniciar essa entrega automaticamente.

Campos não confirmados no formulário não são banco persistido. Reiniciar API exige novo login porque a sessão continua em memória. Busca/carregamento e gravação com falha não substituem dados por sucesso fictício. Restauração/backup do disco e autenticação definitiva para produção precisam da etapa autorizada de implantação.

Documentação antiga foi preservada e sinalizada como histórica; não é evidência de funcionalidades V1.0 implementadas. A síntese V1.0 não representa homologação de todos os marcos; a autorização atual cobre apenas este subincremento.
