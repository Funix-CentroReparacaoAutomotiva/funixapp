# SQLite V7 — componentes exclusivamente por MR

Mudança autorizada na auditoria do PR17. Nesta tarefa, executada somente em bancos temporários criados pelo QA. Nenhuma base normal de desenvolvimento, banco instalado na VPS ou ambiente produtivo foi aberto, excluído ou migrado.

## O que muda

A V7 executa apenas `ALTER TABLE component_items DROP COLUMN fct`, dentro da transação de migrações existente. A instalação nova percorre o histórico e termina em V7, sem essa coluna. Instalação V6 remove a coluna obsoleta sem recriar/resetar tabelas nem apagar Atendimentos, componentes, máscaras, catálogos ou configuração. Preços manuais e quantidades não são convertidos. O código novo não lê, valida, grava nem utiliza o multiplicador individual.

Os DDLs V1–V6 e fixtures de upgrade são históricos imutáveis necessários para atualizar bancos anteriores; não são suporte comercial ativo ao FCT. A API rejeita o campo removido. O único fator de revenda é a opção MR escolhida explicitamente por Atendimento. Sem MR ou preço manual, a emissão permanece pendente; zero de preço é um valor válido. Nenhum fator é deduzido de valores antigos.

Não há reset na inicialização, comando de limpeza automática, exclusão de Atendimentos ou reconstrução do banco. A autorização para descartar dados exclusivos de desenvolvimento não precisou ser utilizada. Snapshots/PDFs antigos podem continuar fisicamente no banco, mas não há lógica de compatibilidade com o multiplicador removido; novos orçamentos usam apenas MR e continuam imutáveis.

## Procedimento para uma futura implantação autorizada

Não executar na Hostinger ou em outro ambiente sem autorização específica para a publicação.

1. Identificar explicitamente a base FUNIX e seu ambiente. Confirmar a revisão V6 e o caminho persistente; não inferir ambiente pelo nome do arquivo. Não tocar bancos/volumes de outros serviços.
2. Obter e verificar uma cópia recuperável do SQLite antes da atualização. O utilitário existente abre a origem somente para leitura e exige um destino novo:

   ```bash
   FUNIX_DATABASE_PATH=/caminho/explicitamente-identificado/funix.sqlite \
     node server/backup.ts /caminho-restrito/backup-antes-v7.sqlite
   ```

3. Em uma **cópia de desenvolvimento/QA**, executar a nova revisão para aplicar V7 e verificar: `MAX(version)` em `schema_migrations` igual a 7; `PRAGMA table_info(component_items)` sem a coluna removida; `PRAGMA foreign_key_check` sem linhas. Conferir catálogos/configurações e um orçamento sintético. Não publicar a cópia de QA nem misturar seus registros à base instalada.
4. Na publicação futura autorizada, iniciar apenas a nova aplicação FUNIX pelo procedimento de implantação existente. O migrador aplica V7 transacionalmente antes de disponibilizar a API. Se ocorrer falha, a transação inteira é revertida; não limpar a base para contornar o erro.
5. Verificar a API e os mesmos metadados de schema. Cadastrar as opções reais de MR na nova área Configurações → Precificação; selecioná-las em cada Atendimento antes de emitir com componentes. Não preencher valores presumidos.

Não se exige reset para receber esse código. Código V6 não aceita schema V7; eventual retorno à revisão anterior requer restauração coordenada da cópia V6 e do aplicativo compatível, sob autorização, sem tentar recriar manualmente a coluna e seus valores. Backups ficam fora do Git e com acesso restrito.

## Provas automatizadas

`server/tests/m1-7-migration.test.ts` cria uma base V6 temporária com registros/catálogos/configuração/máscaras, aplica V7 e compara os dados preservados; testa novo orçamento MR e reinício. Uma view sintética impede a remoção da coluna para provar rollback de schema/histórico/dados. O teste de instalação limpa verifica ausência da coluna. Outros testes preservam integridade, imutabilidade das novas versões, PDF e idempotência.
