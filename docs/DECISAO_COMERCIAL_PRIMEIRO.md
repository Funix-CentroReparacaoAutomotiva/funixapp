# Módulo Comercial do ERP FUNIX — direção e próximo incremento

> HISTÓRICO, SUPERADO NO RECORTE DO MVP V1.0. O CTO autorizou o primeiro subincremento M1 em 24/10/2026. A ordem atual é M1 Atendimento/orçamento → M2 Coda unidirecional → M3 WhatsApp → M4 IA. Não usar as propostas abaixo de PostgreSQL, agendamento ou sincronização como requisitos atuais. Ver `M1_ATENDIMENTOS.md`, `especificacao-v1.0/` e `../AGENTS.md`.

Data: 21/10/2026. Registro da direção confirmada na conversa; não representa implantação, migração ou homologação.

## Confirmado pela direção

- Destino: ERP próprio da FUNIX, substituindo integralmente o Coda ao longo do desenvolvimento.
- Sequência: Comercial primeiro; Produção depois; Financeiro por último.
- O comercial será parte permanente do sistema final, com armazenamento próprio e preservação da UX/UI V20.
- Durante a transição, a operação e o financeiro existentes no Coda continuam atendendo os casos pertinentes.
- Não é necessário construir produção e financeiro novos antes de utilizar o comercial novo. A validação do comercial deve atravessar os processos existentes, em ambiente seguro.

## Estado implementado verificado

Há React/TypeScript/Vite, interface V20, navegação, backend Node, sessão local e adaptador de leitura Coda. Não há banco comercial próprio configurado, persistência comercial ou comandos de negócio implementados. O conector usado na investigação não concede credencial ao processo do aplicativo. A base atual pode ser reaproveitada.

## Próximo incremento recomendado

**Atualização da direção:** antes de fechar o esquema físico do banco ou implementar a migração, elaborar a análise funcional e o redesenho dos processos comerciais. O Coda fornece evidências dos resultados e das regras existentes; seus mecanismos de execução não devem ser traduzidos literalmente. O primeiro rascunho está em `analise-funcional-comercial/ESPECIFICACAO_FUNCIONAL.md`, com lançamento de diagnóstico detalhado em documento próprio. A entrega persistente abaixo continua sendo um marco posterior, condicionado ao entendimento funcional necessário, e não o primeiro passo anterior ao estudo.

**Registrar, localizar, editar e reabrir um Atendimento no banco próprio, pela interface aprovada.**

O modelo deve prever, desde o início, o conjunto comercial: Atendimento, vínculos de conversas/mensagens, diagnóstico, serviços/itens, catálogos, versões de orçamento e evidência de aceite. A implementação inicial dessas entidades será incremental; não se exige construir todas antes do primeiro Atendimento persistente.

Proposta técnica: PostgreSQL como banco relacional, mantendo React/TypeScript e backend modular. Preparar migrações versionadas, IDs próprios e referências externas Coda separadas. O local de hospedagem, credenciais e provisionamento ainda precisam ser definidos/configurados. Não criar infraestrutura paga ou publicar dados por inferência.

Critérios da primeira entrega:

1. Operador autorizado cria Atendimento com informações comerciais proporcionais, sem exigir Cliente/Veículo/Experiência prematuros.
2. O registro recebe ID próprio e aparece no Funil com o status inicial conforme contrato derivado do ERP.
3. O registro pode ser localizado, aberto e atualizado; dados persistem após reiniciar servidor e navegador.
4. Validação, controle de acesso, histórico mínimo de alterações e proteção contra repetição acidental são exercitados.
5. Nenhuma Experiência é criada nem nenhum dado Coda é alterado por esse incremento.

## Incrementos comerciais seguintes

1. Diagnósticos, serviços e itens ligados aos catálogos, com versão/origem definidas.
2. Cálculo comercial com testes de equivalência das regras existentes em ambiente seguro; não inferir regras a partir de nomes de parâmetros.
3. Orçamento versionado, documento, negociação e aceite, preservando escopo/valor anteriormente aceitos.
4. Comunicação real e vínculos Chat↔Atendimento, reaproveitando infraestrutura verificada, sem dois autores para o mesmo evento.
5. Transferência de agendamento ao Coda com versão estruturada, confirmação e recuperação idempotente, seguida de piloto controlado.

Essa ordem pode sobrepor trabalhos independentes. A primeira entrega de Atendimento não será apresentada como módulo comercial completo ou pronto para produção.

## Ainda são propostas técnicas, não mudanças produtivas aprovadas

- Registro mínimo de Atendimento Coda para compatibilidade no momento da transferência.
- Contrato de importação do orçamento e filhos, mapeamento de IDs e recuperação de falhas.
- Autoridade e versionamento dos catálogos/cálculo durante a transição.
- Hospedagem, identidade nominal e papéis dos operadores.
- Coorte piloto, destino dos dados históricos e execução de mutações em cópia segura.

O inventário e os pareceres em `estudo-comercial-erp/` fornecem a evidência técnica. O `PARECER_DIRECAO.md` permanece como estudo da proposta; este registro distingue a sequência agora confirmada dos detalhes que ainda precisam de implementação e validação.
