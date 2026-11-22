# FUNIX — Etapa 1: diagnóstico e matriz proposta

**Escopo executado: leitura de código e GitHub, tentativa de consulta pública, elaboração documental da matriz. Nenhuma implementação ou alteração da aplicação, banco, configurações ou infraestrutura.**

## Resultado do diagnóstico de instalação

| Item | Evidência / resultado |
|---|---|
| Main atual | `b0fdba268bc9250a04267e3d313c3eca26c625c5` |
| Código analisado | Árvore `95da6188b7fcf99fdd94548e3b86204695e8cab2`, idêntica à main; nenhuma alteração local no repositório |
| Última publicação manual registrada | [GitHub Actions 41151094868](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/actions/runs/41151094868), nessa mesma revisão |
| Resultado dessa publicação | validate, publish e deploy aprovados. As etapas de atualização FUNIX e verificação pública HTTPS/revisão do frontend/API concluíram com sucesso |
| O que isso comprova | A revisão aprovada foi implantada e passou pela verificação pública naquele momento. Não é apenas um merge ou publicação no GHCR |
| Estado atual diretamente consultado | Não confirmado: GET de `https://app.funix.com.br/release.json` bloqueado pelo proxy desta sessão: `CONNECT tunnel failed, response 403`, sem resposta HTTP do aplicativo |
| Acesso administrativo | Nenhum canal SSH/identidade administrativa disponibilizado nesta sessão; VPN não configurada e nenhuma rota TCP liberada. Não foram procurados/exibidos conteúdos de chaves, tokens ou senhas |
| Catálogos reais da instalação | Não consultados, pois as rotas são autenticadas e não há canal administrativo/autenticado disponível |
| Tabela/FC/FR/MR do banco instalado | Não consultados. Não se conclui que estejam vazios, completos ou importados |
| Banco/contêineres/configurações da VPS | Não acessados |

A evidência da publicação está no arquivo `EVIDENCIA_PUBLICACAO.json`. O erro 403 é do canal de rede da sessão; não demonstra indisponibilidade ou erro do aplicativo FUNIX.

## Catálogos e parâmetros: fatos do código

- As peças V2 vêm da hierarquia versionada. O catálogo operacional continua único; `active` e identificação controlam usabilidade, sem bloqueio por status de validação ou origem.
- A inicialização não carrega automaticamente os cadastros comerciais reais. O importador pontual existe e exige fonte e destino explícitos; aplicar requer confirmação do plano.
- Diagnósticos/serviços/dimensões vêm de `/api/catalogos`. Dimensões dependem de vínculo pelo `serviceId` correto.
- Opções globais de Tabela/FC/FR/MR vêm de `/api/precificacao`. Seleções por Atendimento vêm do workspace ou `/api/atendimentos/:id/parametros` e persistem em `commercial_state.settings_json`.
- Campo selecionado vazio não comprova lista de opções vazia. Opção cadastrada com fator ausente é diferente de nenhuma opção cadastrada.
- MR é único por Atendimento, aplicado aos componentes pelo motor oficial; não há autorização para presumir seleção automática ou fator neutro.
- O catálogo é reutilizado enquanto o painel está aberto. Uma carga externa requer recarga para conferir o estado atualizado; não foi adicionado polling ou sincronização.

Fontes: `server/migrations.ts`, `server/import-coda.ts`, `server/commercial.ts`, `server/pricing-config.ts`, `server/app.ts`, `shared/commercial.ts`, `src/CommercialPanel.tsx`, `src/FinancialPanel.tsx` e `src/DiagnosisEditor.tsx`.

## Leituras ainda necessárias para encerrar a parte operacional

Quando o canal administrativo/autenticado existente estiver disponível, sem alterar banco ou infraestrutura:

1. Ler `/release.json` e `/api/ready` e conferir se ambos informam a revisão registrada. Comparar também a revisão efetivamente carregada no navegador utilizado no teste, sem presumir que uma aba antiga tenha recarregado.
2. Consultar os catálogos reais e relatar somente contagens, atividade e integridade dos vínculos serviço/dimensão. Não divulgar nomes de clientes ou dados de Atendimentos.
3. Consultar a configuração comercial e verificar presença/completude das opções e das bases técnicas, sem publicar preços/exportações privadas.
4. Em um Atendimento de referência indicado pelo proprietário, verificar por leitura se Tabela/FC/FR/MR estão não selecionados, selecionados corretamente ou referenciam opções indisponíveis.
5. Classificar cada ausência: carga não realizada; cadastro inativo/filtrado; vínculo incorreto; origem incompleta; configuração pendente; ou defeito de API/interface/cache. Não preencher listas com dados artificiais nem aplicar o importador nessa conferência.

A evidência histórica de deploy não autoriza declarar os cadastros disponíveis nem confirmar a aplicação da importação. Para concluir essas leituras, falta disponibilizar a conexão administrativa/autenticada existente e permitir o destino HTTPS do aplicativo no ambiente da sessão. Nenhuma credencial deve ser enviada no texto do chat.

## Matriz proposta — cobertura

Entregáveis documentais publicados nesta pasta, sem implementação da classificação:

- `FUNIX_MATRIZ_163_PROPOSTA.xlsx`: matriz filtrável, decisões, pares Ambos, cobertura e orientação de leitura.
- `FUNIX_MATRIZ_163_PROPOSTA.csv`: os 163 códigos, IDs da base V2, nomes originais, região/categoria/lado/posição, caminho proposto, decisões e caminhos atuais/originais.
- `FUNIX_MATRIZ_163_PROPOSTA.md`: versão textual integral da proposta.
- `FUNIX_AMBOS_PROPOSTOS.csv`: 23 pares candidatos formados exclusivamente por dois códigos reais distintos.
- `VALIDACAO_MATRIZ.json`: contagens, origem e SHA-256 da hierarquia.

A fonte é `server/data/hierarquia-v2.json`, SHA-256 `20d8ac528f3708bf259d5c0d53959d843b189df4583ec24c2c57d026ce827e30`, no commit aprovado. Os IDs `v2:<código>` são os IDs do seed versionado, sem afirmar o estado do cadastro na instalação.

Validação documental executada: 163 linhas; 163 códigos únicos; igualdade exata entre conjunto de códigos de origem e da matriz; 163 caminhos propostos únicos; zero códigos criados/excluídos/fundidos; nomes originais mantidos. Excel foi reaberto e comparado ao conjunto de origem. CSV foi relido. Isso não é teste funcional nem implementação do novo mapa.

| Região lógica proposta | Códigos | Opções no primeiro nível |
|---|---:|---:|
| Frente | 27 | 8 |
| Estrutura dianteira | 7 | 5 |
| Motorista | 40 | 13 |
| Passageiro | 40 | 13 |
| Traseira | 27 | 8 |
| Estrutura traseira | 10 | 7 |
| Topo | 12 | 4 |
| **Total** | **163** | — |

Na projeção geográfica atual, contando folhas de peça e desconsiderando referências de Ambos, os 163 códigos aparecem 199 vezes; 36 códigos têm mais de um caminho. Isso é duplicidade de navegação, não comprovação de registros duplicados no SQLite.

Correção do parecer anterior: o SVG já possui duas áreas visuais chamadas Estrutura. Seus `data-region` atuais reutilizam frente/traseira. A proposta distingue os acessos dessas áreas, sem acrescentar formas ou redesenhar a geometria. Nenhum atributo do SVG foi alterado nesta etapa.

## Caminhos propostos das 13 categorias iniciais laterais

Cada linha abaixo representa uma categoria visível no primeiro nível. O lado é definido pela região, sem uma escolha redundante de Motorista/Passageiro. Estes são caminhos propostos, não rotas implementadas. Para Roda/Pinça/Caixa de roda/Para-barro, o próximo nível apresenta as posições reais disponíveis.

| Nº | Lado Motorista | Lado Passageiro |
|---|---|---|
| 1 | Motorista → Abastecimento | Passageiro → Abastecimento |
| 2 | Motorista → Acessórios e acabamentos | Passageiro → Acessórios e acabamentos |
| 3 | Motorista → Caixa de roda | Passageiro → Caixa de roda |
| 4 | Motorista → Componentes das portas | Passageiro → Componentes das portas |
| 5 | Motorista → Estrutura lateral | Passageiro → Estrutura lateral |
| 6 | Motorista → Lateral traseira | Passageiro → Lateral traseira |
| 7 | Motorista → Para-barro | Passageiro → Para-barro |
| 8 | Motorista → Para-lama | Passageiro → Para-lama |
| 9 | Motorista → Pinça de freio | Passageiro → Pinça de freio |
| 10 | Motorista → Porta de carga lateral | Passageiro → Porta de carga lateral |
| 11 | Motorista → Porta dianteira | Passageiro → Porta dianteira |
| 12 | Motorista → Porta traseira | Passageiro → Porta traseira |
| 13 | Motorista → Roda | Passageiro → Roda |

**Ressalva D05:** 13 categorias por lateral exigem validação visual futura no seletor radial em 320 px, sem paginação no primeiro nível. A publicação desta matriz não comprova que a disposição caiba no círculo nem autoriza alterar o SVG ou esconder categorias.

**Casos ambíguos presentes nessas categorias:** Caixa de roda contém os códigos sem eixo (D02); Estrutura lateral contém os códigos de coluna genérica (D01) e painel lateral interno (D03); Acessórios e acabamentos contém soleiras (D04). Os caminhos individuais e a justificativa estão na matriz. Esses códigos não são fundidos nem convertidos em versões específicas.

## Decisões destacadas para aprovação

| ID | Caso | Códigos diretamente envolvidos | Proposta / decisão necessária |
|---|---|---:|---|
| D01 | Colunas genéricas | 2 | Caminho provisório de identificação pendente, mantendo o código original e sem equivalência A/B/C. Decidir onde manter acesso antes de retirar a opção genérica do mapa |
| D02 | Caixas de roda sem eixo | 2 | Manter um caminho separado de posição não especificada para revisão. Não fundir com dianteira/traseira e não incluir o genérico em Ambos |
| D03 | Agrupamentos estruturais, vidros e interiores | 19 | Aprovar o conteúdo das áreas Estrutura e o acesso de vidros/interiores/painel lateral. É organização de navegação, não mudança da natureza técnica dos cadastros |
| D04 | Soleiras | 2 | A localização lateral é conhecida, mas a origem não distingue acabamento de elemento estrutural; confirmar categoria |
| D05 | Legibilidade dos primeiros níveis laterais | Transversal | A proposta atende os tipos diretos com 13 entradas por lateral. A disposição radial precisa de validação visual futura em 320 px sem esconder categorias nem alterar o SVG |

São 25 linhas com decisão específica D01–D04. As demais 138 também são propostas sujeitas à aprovação; nenhuma foi aplicada. Os caminhos provisórios dos genéricos garantem cobertura documental sem alegar que o conflito esteja resolvido.

Faróis e alojamentos ficam somente na Frente; abastecimento fica separado de iluminação; caixas de roda, rodas, pinças e para-barros ficam nas laterais, por tipo e depois posição; porta de carga lateral permanece. Cada par Ambos aponta para dois códigos existentes, condicionado à usabilidade dos dois no catálogo real. Não são criadas peças físicas ou códigos para Ambos.

## Diretrizes aprovadas registradas para etapas futuras

- Mapa e lista de Diagnósticos: presença da peça na composição compartilhada.
- Editor e matriz de comparação: habilitação por cenário, inclusive de itens filhos.
- Desseleção global deve pedir confirmação compacta quando houver outros cenários habilitados **ou** serviços/componentes preenchidos. Quando houver outros cenários ativos, sua numeração deverá ser apresentada dinamicamente. Cancelar não pode gerar gravação.
- Códigos/IDs reais e nomes dos cadastros não devem ser excluídos, fundidos ou renomeados sem aprovação.

Essas diretrizes foram apenas registradas, sem implementação, mudança de contrato, testes com gravação ou alteração de dados.

## Limite da entrega

O diagnóstico preliminar foi aprovado pela direção; a matriz documental foi entregue para revisão e ainda não está aprovada para implementação. O diagnóstico do código e o histórico de publicação foram conferidos; a leitura atual da instalação/catálogos/parâmetros permanece impedida pelo acesso indisponível. Nenhum teste foi executado no banco existente. Não houve importação, backup, merge, deploy ou implementação das Etapas 2, 3 ou 4.
