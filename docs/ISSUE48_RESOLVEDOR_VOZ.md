# Issue #48 — resolvedor de ambiguidades

Base: `main` em `8e9d3377441dcabd16178d48e5e26811841c141a` (PR #47, revisão compacta). Branch: `feat/issue48-voice-resolution`.

## Fluxo entregue

- Até três alternativas reais diretamente na pendência; “Mais opções” revela outras alternativas emitidas pelo servidor. Referências a peças, serviços, dimensões, diagnósticos e linhas repetidas são tratadas sequencialmente.
- “Caixa de ar” sem lado e três serviços gera uma única dúvida. Motorista/Passageiro reconstrói as operações dependentes daquela peça. Ambos expande somente pares presentes na hierarquia oficial e no catálogo ativo: duas peças físicas, comandos com IDs distintos e serviços associados a cada peça. Referências a IDs concretos de linha ou dependências externas impedem a expansão insegura.
- Seleção de serviço restringe dimensões à relação real. Linhas repetidas mostram posição/dimensão/quantidade. Cadastros inativos não são oferecidos; peças existentes inativas não são substituídas para resolver uma dúvida de serviço.
- Nenhuma seleção grava no SQLite. A revisão é recalculada no servidor e exige confirmação humana para aplicar. Pendências informam explicitamente “Não será aplicado sem resolver”.
- Falar grava um esclarecimento curto sem perder a revisão. A transcrição seleciona uma opção ou nome exato de cadastro; não reinterpreta o lote, não altera quantidades/notas/intenções originais e não concede autorização para excluir ou emitir.
- Aplicar assim mesmo confirma somente mudanças seguras; zero mudanças mantém o botão desabilitado e o backend recusa aplicação vazia. Dimensão null é mantida apenas quando o contrato já permite rascunho incompleto; cálculo/emissão continuam bloqueados pelos critérios existentes.
- Botões de apoio ficam fora da rolagem. Revisão compacta, teclado, atualização/limpeza após sucesso e negociação local da PR45 foram preservados.

## Arquitetura e segurança

`voice-resolution.ts` guarda o lote validado e a transcrição original por no máximo 15 minutos, com limite de 100 revisões por conexão de banco e vínculo à sessão/Atendimento/cenário/digest. Opções e pendências recebem UUIDs opacos; o browser envia apenas o ID da opção e o contexto da revisão em `POST /copiloto/resolver`. Campos/IDs/comandos livres adicionais são recusados.

Cada escolha verifica novamente contexto, catálogo, relações e recibos, reconstrói o lote confiável e gera nova chave de idempotência. A revisão anterior e seu plano de aplicação são invalidados, impedindo aplicar versões diferentes do mesmo lote. O TTL original não é estendido. Seleções concorrentes produzem uma revisão válida e rejeição da versão substituída.

O esclarecimento usa a rota de áudio existente com IDs opacos de revisão/pendência. Reutiliza autenticação, origem, limites, cancelamento, rate limit e timeout. Antes e depois da transcrição verifica sessão e contexto; não chama novamente a interpretação. Nomes são associados conservadoramente ao catálogo, sem criar tabela de equivalências. Sem match inequívoco, mantém o plano anterior.

O modelo recebe somente pares reais da hierarquia para representar um ditado que já explicite ambos, com comandos separados; Ambos não é referência de catálogo. A seleção manual do resolvedor usa a mesma fonte de pareamento e não infere esquerda/direita.

A aplicação continua pelo planejador existente, dentro de BEGIN IMMEDIATE/COMMIT/ROLLBACK e com recibo durável. O contrato JSON de confirmação, a exigência adicional para exclusões globais e os repositórios/motor permanecem. Foi acrescentada rejeição explícita de plano sem mudanças e rechecagem de sessão depois de ler o JSON das rotas resolver/aplicar, cobrindo logout durante envio lento.

## Validação

- `npm run check`: build, tipos, **451 testes aprovados**, zero falhas/ignorados; lint com avisos. Há um aviso estático de refs nos callbacks da captura, além dos avisos anteriores; o construtor armazena callbacks e não os executa durante renderização.
- 16 testes SQLite novos: três escolhas de lado com três serviços; uma pendência visual; ausência de writes durante resolução; associação de Ambos, IDs e flags; preservação de serviço já existente; versões antigas invalidadas; linha repetida/exclusão global; serviço/dimensão/diagnóstico sequenciais; opções falsas/manipuladas; sessão/cenário/stale/expiração; aplicação parcial segura; dimensão null permitida/emissão bloqueada; referência obrigatória inexistente; nome exato; preservação de peça legada inativa; nomes idênticos diferenciados por códigos reais ou recusados; rollback e snapshot/PDF imutáveis.
- Cinco testes HTTP novos: origem/autenticação/body adulterado; resolução concorrente; aplicação simultânea sem duplicação; Falar preservando lote e sem nova interpretação; contexto alterado/logout durante transcrição; logout durante envio JSON nas duas rotas. Esses cenários estão agrupados nos cinco testes.
- `node scripts/voice-resolution-browser.mjs`: aprovado em **320/390/1440 px**. Opções de lado por clique/teclado; máximo de três alternativas; Mais opções; cadastro inativo ausente; serviço/dimensão sequenciais; Falar inválido/ambiguidades preservadas; Falar Ambos; transcrição original retida; seis serviços associados; confirmação; negociação **R$ 123,45**; nenhuma alternativa inventada; aplicação apenas da alteração independente; CTA alcançável.
- `node scripts/voice-browser-review.mjs`: regressão anterior aprovada em **320/390/1440 px**, incluindo resumo, teclado/transcrição, erro HTTP 503 recuperável, negociação com prévia atualizada e cancelamento/confirmação de exclusão global.
- O workflow Chromium existente passa a executar os dois roteiros. Todos os bancos, credenciais de teste e provedores são sintéticos. As capturas ficam em [evidências](evidencias/issue48-resolvedor).

## Limites explícitos

- Falar aceita uma opção ou nome exato; não interpreta frases livres de correção, intenções contraditórias, lotes sem uma operação obrigatória ou ordens novas. Nesses casos preserva o plano e orienta novo esclarecimento/ditado. Não há interpretação paralela improvisada.
- Quando não há equivalência verificável ou há nomes idênticos sem distinção confiável, não oferece palpite nem escolhe sozinho. Configurações fora do contrato continuam pendentes.
- A sessão de resolução é temporária e se perde após reinício. Recibos já confirmados permanecem duráveis; revisões antigas não podem ser recuperadas para nova gravação.
- Emulação Chromium e microfone/provedor simulados não substituem homologação em Android/iOS com áudio real.

Sem migração ou novo ambiente, sem preços, componentes por voz, alteração de regras comerciais, acesso a dados publicados, merge ou deploy. A inclusão de componentes permanece para a próxima entrega.
