# Prompt de partida — Codex | Aplicativo FUNIX

Você assumirá o desenvolvimento integral do **Aplicativo FUNIX**, uma aplicação para a operação comercial e o acompanhamento de veículos de uma oficina de funilaria e pintura em Contagem/MG.

**Os arquivos que estou lhe entregando são:**

- `GUIA_MESTRE_CODEX_APP_FUNIX.md` — especificação consolidada do produto, domínio, UX, integrações, riscos, plano e critérios de aceite. **Leia integralmente.**
- `FUNIX_V20_Menu_Compacto_Kanban.html` — **referência visual e de interação aprovada**. Abra e explore o protótipo no navegador, em desktop e em celular. É demonstrativo, não está conectado ao ERP.
- `referencias/00_master_index.md` a `referencias/10_strategy.md` — documentos de contexto institucional, conforme a hierarquia estabelecida no índice. Não presuma que versões ou recursos não verificados já estejam implantados.
- `AGENTS.md` — instruções operacionais curtas para o repositório.

## Missão

Transforme a **visão de cima**, representada pela V20 e pelas decisões do guia, na **aplicação real** que se conecta à **visão de baixo**, representada pelo ERP FUNIX já existente no **Coda** e por suas integrações e processos.

O aplicativo terá três áreas iniciais: **Conversas**, **Funil** e **Veículos** (acompanhamento + histórico). Conversas é uma porta de entrada para o **Atendimento**, não uma tela de chat independente. A abertura leva às três visões internas já desenhadas: **Chat, Mapa e Diagnósticos**. O Funil opera com **Atendimentos**; Acompanhamento e Histórico operam com **Experiências**. Agendar gera uma Experiência vinculada a um Atendimento (regra de negócio 1:1). Chats e Atendimentos têm relação conceitual N:N. O **Copiloto FUNIX** deve estar disponível globalmente, capaz de localizar registros reais, aplicar filtros, navegar e abrir cards preservando contexto.

**Atenção crítica:** não replique estados ou ações do protótipo como se fossem regras reais. No Coda, a fase operacional da Experiência é **calculada** a partir de eventos, OS e processos, não uma simples coluna editável. Investigue o ERP de verdade e preserve seu fluxo de Atendimento→Orçamento→Agendamento→Experiência→OS→Saída, com autorização, idempotência e trilha de auditoria.

## Como quero que você trabalhe

1. **Primeiro**, leia o guia e a V20. Inspecione o repositório/ambiente existente e identifique as conexões realmente disponíveis ao **Coda (incluindo Superhuman Docs), Evolution API, n8n, Redis, jsreport** e o serviço mencionado como **Imagine.io**, sem supor disponibilidade ou função específica. Faça as primeiras consultas ao ERP **somente leitura**.
2. Extraia um **mapa de domínio e contratos reais**: tabelas/colunas/tipos/fórmulas, status, relações, ações e dono dos dados; diferencie o que foi verificado do que ainda precisa ser confirmado. Audite especialmente agendamento, orçamentos e OS em cópia/ambiente seguro antes de qualquer escrita.
3. Sugira uma arquitetura técnica **simples, sustentável e compatível com o que já existe**. Manter Coda como sistema de registro inicialmente; não migrar banco nem reproduzir integrações em outro serviço sem justificativa e aprovação.
4. **Comece a implementar**, não apenas a documentar: estrutura executável, navegação fiel à V20 e primeiras consultas reais seguras. Progrida por fatias verticais testáveis, até concluir comunicação, atendimento, produção, histórico e Copiloto.
5. Preserve o visual aprovado: entrada compacta sem cabeçalhos/rodapés inúteis; Kanban horizontal, recolhível e com Quadro/Lista; seta de volta no header à esquerda do nome; retorno à origem com filtros/scroll preservados; Copiloto laranja fixo sem cobrir ações.
6. Trate os dados do HTML como **fictícios**. Não deixar mocks parecerem registros reais; não afirmar sucesso de ação sem confirmação do backend. Autorização, privacidade, LGPD, rastreabilidade, proteção de credenciais, deduplicação e rollback são obrigatórios.
7. Para cada entrega: explique o que implementou, como executar, qual foi o teste realizado, o que ainda está simulado, quais riscos permanecem e qual é o próximo incremento.

**Não me peça para redesenhar a interface ou reexplicar decisões já documentadas.** Faça escolhas técnicas reversíveis quando a evidência for suficiente; peça minha decisão quando houver impacto material em dados produtivos, segurança, dinheiro, fluxo comercial/operacional ou integridade de registros.

## Primeiro retorno esperado

Depois de inspecionar os arquivos e os acessos reais, me mostre sucintamente: **(a)** o que existe e funciona de fato; **(b)** o mapeamento básico entre V20 e Coda; **(c)** os riscos/bloqueios que exigem decisão; **(d)** a arquitetura e os marcos de entrega; **(e)** o primeiro incremento executável que você já começou ou vai implementar imediatamente. Priorize evidências e código, não apresentação.

**O objetivo não é construir outro mockup. É entregar o aplicativo FUNIX real, evoluindo com fidelidade à V20 e respeitando o ERP existente.**
