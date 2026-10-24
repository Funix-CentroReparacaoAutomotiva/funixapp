# FUNIX — M1.2: Catálogos e Estrutura de Diagnósticos

Entrega local para revisão, a partir do M1.1 integralmente auditado (`3bf660eb5eb0500957a3f99552708d091a73b98b`). Branch: `codex/m1-2-catalogos-diagnosticos`. Publicação autorizada pela direção exclusivamente nesta branch para auditoria independente. O SHA exato será informado na entrega da publicação; sem merge ou deploy.

## Resultado utilizável

O operador abre um Atendimento existente, acessa **Diagnósticos** ou **Mapa**, mantém seus **Catálogos**, valida a identificação das peças e adiciona peças à composição. Pode escolher diagnóstico, acrescentar serviços, dimensões e quantidades, salvar, reabrir, desmarcar ou remover itens. As operações são locais e persistentes. Criar orçamento, Chat e IA continuam indisponíveis.

Não houve redesenho geral nem substituição de tecnologia. Permanecem React/TypeScript/Vite, Node 24, autenticação de operador e SQLite nativo. Nenhuma dependência foi adicionada. As regras de criação/edição de Atendimento, telefone obrigatório, fases, recusa, busca e cabeçalho do M1.1 foram preservadas.

## Migração e preservação do M1.1

`server/migrations.ts` agora executa uma sequência ordenada de migrações dentro de `BEGIN IMMEDIATE`, incluindo a descoberta da versão. A versão 1 mantém seu SQL original. A versão 2 é aditiva:

| Tabela nova | Responsabilidade |
|---|---|
| `catalog_items` | Peça, diagnóstico, serviço ou dimensão; identificação, origem, validação, atividade, revisão e datas |
| `catalog_history` | Metadados de cada revisão do cadastro, inclusive entrada inicial |
| `diagnosis_items` | Composição por peça física e Atendimento, diagnóstico opcional, observações e inclusão |
| `diagnosis_services` | Serviços filhos, dimensão opcional, quantidade decimal exata e inclusão |

Não existe `DROP`/recriação de Atendimentos, carga de clientes nem leitura Coda. FK preserva vínculos; exclusão de composição remove seus serviços em cascata. Cadastro de catálogo é inativado, não excluído. A revisão impede sobrescrever edições concorrentes.

O teste usa `server/tests/fixtures/m1_1_schema.sql`, extraído do SQL da migração do commit auditado, cria Atendimentos sintéticos com campos preenchidos, telefone repetido e recusa. Compara **todas as colunas brutas** e a definição SQL da tabela antes/depois da atualização e da segunda abertura. Também testa falha durante V2: tabelas parcialmente criadas e registro de versão são revertidos, mantendo dados anteriores. Arquivo desconhecido, histórico inconsistente e versão futura são recusados sem reset.

Não há downgrade destrutivo. Um binário M1.1 recusa um banco V2. Para voltar ao binário anterior, deve-se preservar o banco atualizado e restaurar uma cópia anterior compatível com a API parada; isso pode excluir alterações posteriores à cópia e exige decisão operacional. O comando de backup consistente do M1.1 permanece disponível. Nenhum banco real foi atualizado nos testes.

## Catálogos e significado da V2

O arquivo empacotado em `server/data/hierarquia-v2.json` é idêntico, byte a byte, ao original recebido, verificado por teste SHA-256. Os 20 documentos originais continuam íntegros. A estrutura mantém cinco vistas e acesso geral separado. Atalhos Estrutura do desenho conduzem à respectiva vista frente/traseira.

- **163 códigos físicos** não vazios, deduplicados entre vistas, entram como **proposta**. Código existente na V2 não constitui validação técnica ou comercial.
- `suggestion` preserva a origem `sugestao_nova`; antes da validação, a tela distingue **Sugestão V2** de **Proposta**.
- **23 folhas sem código** continuam navegáveis/pesquisáveis, identificadas como pendentes e bloqueadas para composição. Não receberam códigos ou peças físicas artificiais.
- **123 ações Ambos** continuam ações: inserem as duas peças codificadas numa transação. Se um lado estiver pendente, nenhum é inserido. Repetir uma vista/seleção não duplica a peça no Atendimento.
- A validação exige ação explícita do operador. Validação e atividade são independentes da origem: continuam registradas as sugestões e sua proveniência mesmo depois da confirmação.

Peças próprias fora da árvore podem ser cadastradas com código efetivamente informado pelo operador e selecionadas em acesso separado. Isso não altera nem resolve silenciosamente os nós sem código da V2. Código físico não é editável depois de criado; a chave técnica interna é separada. Código duplicado gera erro útil.

Serviços, diagnósticos e dimensões começam **vazios**. A manutenção permite criar, editar, validar, inativar e consultar datas/revisões. Dimensão pertence a um serviço validado; não contém FD ou preço. Não foram importados exemplos do protótipo ou catálogos Coda.

## Interface e composição

A entrada permanece Conversas/Funil, com as abas Chat/Diagnósticos/Mapa no Atendimento. Foram reaproveitados o SVG, cores, cabeçalho, largura da aplicação, cartões e controles V20. As regiões do desenho aceitam mouse/toque e teclado. A seleção abre os grupos originais sem criar pastas extras; busca global usa a mesma identidade física.

Um item por peça física em cada Atendimento contém diagnóstico de catálogo opcional, observações e serviços manuais. Cada serviço contém referência própria, dimensão opcional, quantidade positiva e inclusão. Não é gerada relação automática dano→serviço. O rascunho pode ser salvo com diagnóstico/dimensão ainda pendente, sem declarar orçamento completo.

As quantidades são **strings decimais exatas**, inclusive frações; nunca são calculadas ou gravadas como float. Limite técnico: nove dígitos inteiros e seis casas decimais, sem expoente; `"0.250000"` volta como `"0.25"`. Dinheiro não integra este modelo ainda.

É possível editar/remover serviços, desmarcar item/serviço e excluir a peça com confirmação. Um diagnóstico desmarcado mantém seus filhos para edição, sem criar valores ou habilitar precificação. A futura elegibilidade deverá respeitar o pai. Referências a catálogos depois inativados são mantidas e identificadas, permitindo corrigir ou remover seleções anteriores.

Troca de contexto, aba e abertura do formulário de Atendimento avisam sobre alterações não salvas. Escritas bloqueiam navegação enquanto em andamento. Falhas mantêm campos; conflito 409 pede reabertura e a volta à lista atualiza os dados salvos. Expiração de sessão em uma escrita comercial permite autenticar novamente conservando o formulário. Formulários não salvos ainda não são persistência em banco.

## Arquivos principais

| Arquivo | Mudança |
|---|---|
| `server/migrations.ts` | Runner incremental e migração 2 |
| `server/hierarchy.ts`, `server/data/hierarquia-v2.json` | Fonte navegacional e deduplicação dos códigos fornecidos |
| `server/commercial.ts` | Catálogos, histórico, seleção e composição transacional |
| `shared/commercial.ts` | Contratos de metadados e rascunho, separados de preços |
| `server/app.ts` | Endpoints autenticados de catálogo/diagnóstico; sem adaptador externo |
| `src/CommercialPanel.tsx` | Manutenção, árvore/busca, mapa e edição da composição |
| `src/App.tsx`, `src/App.css`, `src/assets/car-map.svg` | Integração no shell V20 e proteção de alterações não salvas |
| `server/tests/commercial.test.ts`, `fixtures/m1_1_schema.sql` | Preservação M1.1, rollback, referências e persistência |
| `server/tests/app.test.ts` | Rotas, sessão/origem/JSON, IDs V2 codificados e ausência de rede |
| `server/tests/atendimentos.test.ts` | Versão futura do teste passa de 2 para 999, pois 2 agora é versão implementada |
| `tests/browser/m1_2_catalogos.py` | Cenários reais em desktop/mobile e reinício da API |
| `Dockerfile`, `.dockerignore` | Inclusão do JSON estático necessário ao runtime; nenhuma mudança de Compose/VPS |
| `AGENTS.md`, `README.md`, `docs/API.md` | Escopo autorizado e contratos atuais |

A relação completa, incluindo novas evidências, consta em [evidencias/m1-2/ARQUIVOS.txt](evidencias/m1-2/ARQUIVOS.txt). O relatório M1.1 e suas evidências originais não foram substituídos.

## Validação executada

| Verificação | Resultado |
|---|---|
| `npm run check` | Build frontend, TypeScript backend, **29 testes Node**, lint sem erros; permanecem os quatro avisos anteriores de set-state-in-effect em App.tsx |
| `python3 tests/browser/m1_2_catalogos.py` | **7 grupos** de cenários reais, incluindo quantidade fracionária, ambos/deduplicação, cadastro/histórico, conflito, falha, reautenticação e mobile após reinício |
| Regressão `tests/browser/m1_atendimentos.py` | **19 grupos** aprovados, com saídas redirecionadas para subdiretório M1.2 |
| `python3 -m unittest discover -s deploy/tests -v` | **7 testes existentes** aprovados; Docker simulado, sem deploy real |
| Build Docker target `api` + smoke local | Fonte V2 incluída, migração e reabertura de diagnóstico com quantidade exata; usuário não root, filesystem read-only, SQLite em tmpfs, **sem rede ou portas publicadas** |
| Integridade | `git diff --check` sem erros; 20 originais SHA-256 preservados |

Logs e comandos reproduzíveis: [evidencias/m1-2/COMANDOS.md](evidencias/m1-2/COMANDOS.md). Resultados do navegador: [evidencias/m1-2/resultados.json](evidencias/m1-2/resultados.json). Capturas contêm somente dados sintéticos identificados como QA. O teste de navegador intercepta **somente uma falha PATCH 503**; a expiração 401 e a concorrência 409 usam a API real. Nenhum sucesso de persistência é simulado.

Os testes usam arquivos temporários e recusam ocupar/interromper serviços já existentes nas portas de desenvolvimento. O isolamento do navegador bloqueia hosts externos e registra zero acessos. A API também foi exercitada com `fetch` proibido no teste de contrato.

## Limites e dependências reais

1. A direção ainda fornecerá os conteúdos dos catálogos comerciais: danos/intensidades quando aplicáveis, serviços, dimensões, fatores, preços e relações técnicas. A estrutura entregue cobre identificação e composição manual; não antecipa essas regras.
2. A V2 precisa de saneamento/validação comercial, especialmente 23 folhas sem código, propostas novas e possíveis sobreposições genéricas/variantes. Compatibilidade por veículo e equivalências físicas além dos códigos fornecidos permanecem conferência humana. Não há seleção automática por modelo.
3. Ainda não há importador em lote, vinculação de folhas sem código a cadastros definitivos, edição da árvore, componentes manuais, motor de preços/energia/prazo, versões A/B/C ou PDF. São trabalhos posteriores, não pré-requisitos fabricados para salvar o rascunho atual.
4. **Múltiplos danos na mesma peça não estão modelados como registros independentes.** Cada item de peça tem somente um `diagnosisId`, observações e vários serviços. A unicidade `(atendimento_id,piece_id)` evita duplicações de peça, mas também impede representar dois itens distintos para danos diferentes dessa mesma peça. Trocar o diagnóstico substitui a referência anterior; não acrescenta um segundo dano nem recalcula os serviços existentes. Observações livres não equivalem a suporte estruturado a múltiplos danos. Esta limitação deve ser avaliada pela auditoria; nenhuma correção funcional foi feita nesta publicação. Taxonomias de intensidade/dano dependerão das tabelas fornecidas.
5. Um catálogo alterado aparece com seus metadados atuais nos rascunhos. Não há versões emitidas nesta entrega; o snapshot imutável pertence a incremento posterior.
6. Não há integração ativa de Coda, WhatsApp ou IA. Nenhuma alteração nesses sistemas, na VPS, DNS, Traefik, workflows, secrets ou Compose. O ajuste Docker apenas empacota um recurso estático da aplicação; nenhum registro de imagem foi publicado.
7. SQLite permanece aceito para o MVP. Volume persistente e backup externo antes de produção continuam pendentes da etapa de implantação, conforme decisão do CTO; não foi acrescentada infraestrutura.

A adequação da cardinalidade de danos por peça está explicitamente submetida à auditoria. Código funcional preservado nesta preparação de publicação. O M1.2 termina nesta revisão; nenhum próximo subincremento foi iniciado. Veja também [o roteiro de auditoria](evidencias/m1-2/AUDITORIA.md).
