# Editor de diagnóstico e painel financeiro aprovados

Implementação do PR17 na branch `feat/editor-autosave-mr`. A base inicial foi main `ef7633f310e0b8b8f498df4445012e408e8df3e7`; a revisão conceitualmente auditada foi `bbcaa82fe667dfef9da8ff49ec72fb22df9cfc91`. As decisões posteriores da direção foram implementadas e são descritas em **[PR17_AJUSTES_AUDITORIA.md](PR17_AJUSTES_AUDITORIA.md)**, relatório vigente desta entrega.

## Comportamento atual

- Editor conforme os dois HTMLs originais: cabeçalho/diagnóstico, observação única da peça, serviços e componentes em duas linhas, ícones/divisórias e autosave real. Campos históricos de diagnóstico/nota por serviço continuam preservados internamente; não se confundem com o multiplicador individual removido.
- Seletores/toggles válidos salvam imediatamente; texto usa debounce de 450 ms. Linhas sem identificação/quantidade válida ficam como rascunho local. Preço manual ausente gera pendência, zero explícito é válido. IDs estáveis, serviços repetidos, flags por cenário, exclusões globais confirmadas e recuperação de conflitos/respostas perdidas continuam disponíveis.
- A linha em alteração exibe **Calculando…** até a confirmação do backend, incluindo a leitura recalculada; em falha, **Valor não atualizado**. Totais afetados não são apresentados como definitivos, sem bloquear a edição dos demais campos nem calcular dinheiro no frontend.
- Painel financeiro único e recolhível no rodapé de Diagnósticos/Mapa, com seletores Tabela/FC/FR/MR e somente Desconto/Negociação; zero é sem ajuste. O backend calcula ajuste e totais exatos. Negociação geral usa a API existente `valueIncludesComponents:true`.
- Emitir orçamento obtém a prévia internamente, exige conferência expressa/ciência residual e mantém `previewToken` e chave idempotente no reenvio. Sessão expirada pode ser renovada sem perder campos/chave. Prévia não emite; novas versões e PDF permanecem imutáveis.
- Histórico/PDF do Atendimento ficam no seu menu de cenários. A manutenção global de catálogos, preços, etapas e opções de fatores está em **Configurações** (`/configuracoes`) na página inicial, sem depender de Atendimento.

## MR e banco

O único multiplicador de revenda é MR por Atendimento: `teto_R$0,05(preço manual × MR) × quantidade`. Serviços, energia e negociação preservam suas fórmulas. Opções MR são cadastradas explicitamente, sem seed ou valores presumidos.

A migração V7 remove o campo FCT do schema ativo e do contrato/repositório/frontend; novos PDFs mostram MR. Não foi necessário apagar Atendimentos, catálogos ou configurações. Não há reset automático nem lógica para compatibilizar o cálculo pelo fator antigo. Os DDLs históricos são preservados somente para permitir upgrade. [Procedimento futuro de migração, backup e retorno](MIGRACAO_V7_MR.md), sem execução na VPS nesta tarefa.

## Validação e visual

```bash
npm run check
python3 -m unittest discover -s deploy/tests -v
python3 tests/browser/pr17_auditoria_regressions.py
git diff --check
```

[Comandos e resultados atuais](evidencias/pr17-ajustes/COMANDOS.md). [Relatório com arquivos e screenshots desktop/mobile](PR17_AJUSTES_AUDITORIA.md). Evidências anteriores em `evidencias/editor-financeiro/` são o registro da primeira revisão; não representam os ajustes posteriores.

Os HTMLs recebidos estão integralmente em `referencias/editor-financeiro/`, com seus hashes originais. O QA compara estilos computados e recortes das telas reais com os originais na mesma largura. Mantém-se o shell V20 de máximo 520 px, com painel limitado/rolável no celular. Não se afirma igualdade de pixels com PNG ilustrativo nem homologação produtiva. Textos transitórios e os caminhos administrativos/históricos são adaptações funcionais explicitadas pela direção.

Sem merge, deploy, acesso a banco instalado, VPS, Coda ou alteração de workflows/segredos. A entrega para na auditoria/homologação da direção.
