# Issue #31 — Etapa 3/6: editor e estados

Base auditada: `ef5c4b1f748c3d5491e070e01a15cef9b5da3acf`. Branch: `feature/revisao-integrada-funix`. Escopo E01–E09 e C05–C06 conforme [aprovação da Etapa 2](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/31#issuecomment-6540238869). Somente desenvolvimento e testes locais sintéticos. Parar para auditoria antes da Etapa 4; sem merge/deploy/importação.

## Entrega por requisito

| ID | Situação | Implementação / prova |
| --- | --- | --- |
| E01 | Atendido | Knob preenchido ligado e vazado desligado, mantendo posição, ARIA e teclado. `ApprovedIcon.tsx`; testes nas três larguras. |
| E02 | Atendido | Fundo decorativo retirado dos toggles de lista/editor. Contorno de foco continua visível e não representa o estado de inclusão. `diagnosis-editor.css`. |
| E03 | Atendido | Uma linha Toggle / Selecionar diagnóstico / Anotações, sem terceira linha isolada; cabeçalho contextual existente conserva nome da peça. `DiagnosisEditor.tsx`; medidas geométricas a 320/390/1440 px. |
| E04 | Atendido | Card tracejado clicável de serviço vazio reutiliza adicionar serviço e foca o campo; desaparece após inclusão. |
| E05 | Atendido | Equivalente para componente; sem preço/MR automático. Campos e apresentação da Etapa D mantidos. |
| E06 | Atendido | Seta SVG centralizada, alvo 44×44 e contorno claro/transparente no editor. Histórico, guard e navegação contextual existentes preservados. `App.tsx` mudou somente o desenho da seta. |
| E07 | Atendido | `PieceSheet` nativo modal, ancorado no rodapé, scroll interno/safe-area, Escape/fechar/backdrop, foco inicial e retorno ao acionador. Mesmos busca, catálogo, confirmação e fila global; fechar o sheet não desmonta a fila nem descarta intenções; os bloqueios existentes do Atendimento e a recuperação explícita são preservados. |
| E08 | Preservado | Mesmo picker funcional/busca unificada em `CommercialPanel.tsx`, sem catálogo paralelo, agrupamentos ou IDs novos. Busca no Mapa não foi modificada. |
| E09 | Preservado | Componentes fracionários, anotações, cenários e comparação; regressões de navegação, flags, MR, preços, emissão e PDF. |
| C05 | Atendido na apresentação | Valores ausentes indicam pendência; linhas identificam configuração pendente, componentes distinguem MR/preço ausentes. Painel expandido apresenta o motivo do motor e seletores permanecem utilizáveis após confirmação. Sem inferir valores/defaults. |
| C06 | Atendido | Rascunho incompleto distingue-se de requisição pendente/erro. Serviço vazio, dimensão ausente, quantidade inválida e componente sem nome não ficam eternamente em “Calculando…”. |

## Persistência e cálculo são estados diferentes

- **Salvando:** operação real iniciada, ainda sem confirmação. ACK e revisões do servidor continuam sendo a única confirmação de persistência; não há timeout que finja sucesso.
- **Salvo:** entradas persistíveis confirmadas. Não provoca falso aviso de descarte ao voltar. Isto não significa que todo preço possa ser calculado.
- **Rascunho incompleto:** entrada local sem serviço/nome ou com quantidade/preço inválidos; permanece no formulário com guard de saída. Uma linha existente inválida nunca é omitida de um PATCH, evitando apagá-la por filtragem. Nenhuma chamada é iniciada apenas para tentar salvar esse estado inválido.
- **Dados salvos ainda incompletos para cálculo:** serviço com dimensão nula e componente com preço manual nulo continuam sendo rascunhos persistíveis permitidos pela API. A confirmação permite voltar sem alerta falso, mas o preço permanece incompleto/indisponível; preço nulo não vira zero. Serviço desabilitado com dimensão ausente não bloqueia o cálculo efetivo só pela ausência daquela dimensão.
- **Configuração pendente:** entradas confirmadas sem parâmetro/regra oficial suficiente. Usam-se erros e resultados do motor existente. Totais parciais oficiais continuam visíveis quando disponíveis. Seletores não ficam bloqueados como se houvesse uma requisição eterna.
- **Erro:** campos mantidos, indicação visível e recuperação explícita. Reconciliação existente primeiro consulta o estado salvo; não há repetição cega de escrita incerta.

Validação de completude em `calculation-state.ts` e `component-presentation.ts` não calcula dinheiro nem altera o contrato de persistência. Quantidades aceitas seguem o formato da API. Fórmulas, fatores e cálculo de inclusão efetiva permanecem no backend.

Mensagens normais de rascunho/salvamento são anúncios acessíveis fora do fluxo visual; não deslocam os controles nem criam toast verde. Incompletude e falha reais permanecem visíveis. O painel financeiro recebeu somente tratamento/indicação de estados C05–C06, sem reorganização de botões, rodapé ou Copiloto.

## Arquivos e limites

Frontend: `src/DiagnosisEditor.tsx`, `ApprovedIcon.tsx`, `CommercialPanel.tsx`, `FinancialPanel.tsx`, `calculation-state.ts`, `component-presentation.ts`, novos `PieceSheet.tsx`, `piece-sheet.css`, `diagnosis-editor.css`; seta em `App.tsx`. Testes de apresentação em `server/tests/`, QA e evidências abaixo; AGENTS atualizado com a autorização atual.

Fila/hook de seleção, remoção transacional/revisões, backend/API, migrações, importador, motor comercial, configuração comercial, taxonomia/paths/CSS do Mapa e workflows não foram modificados. Os contratos da Etapa 2 são reexecutados sem alterar seu teste dedicado. Desseleção continua global; habilitação no editor/comparação continua por cenário. Snapshots e PDFs emitidos são conferidos por igualdade/hash após edições, remoções, falhas e reinício.

## Reprodução

```sh
npm run check
python -m unittest discover -s deploy/tests -v
python tests/browser/etapa3_editor.py
PYTHONPATH=tests/browser python - <<'PY'
import asyncio, etapa2_persistencia as s
s.ARTIFACTS = s.ROOT / '.runtime/etapa3/etapa2'
s.ARTIFACTS.mkdir(parents=True, exist_ok=True)
asyncio.run(s.run())
PY
python tests/browser/etapa3_regressions.py
```

Executar navegadores sequencialmente, com portas 5173/8787 livres. Usam Chromium local, API real e arquivos SQLite temporários sintéticos; não consultam exportações privadas, SQLite instalado, Coda ou VPS. Evidências antigas não são sobrescritas. O runner de regressão grava em `.runtime/etapa3/`, ignorado pelo Git.

## Resultados

Consultar [evidências da Etapa 3](evidencias/etapa3/): comandos, logs, resultados estruturados e screenshots desktop 1440×1000 / mobile emulado 390×844 e 320×568. **Resultado final local:** `npm run check` aprovado (build/TypeScript, 150 testes Node, zero erros de lint; quatro avisos preexistentes em `App.tsx`); 23 testes dos scripts de implantação; **21 grupos da Etapa 3 + 21 da Etapa 2 + 121 de regressão = 163 grupos de navegador aprovados**, com 24 screenshots. A rodada final dedicada inclui contenção de Tab/Shift+Tab e retorno bloqueado durante PATCH pendente. Contratos da Etapa 2 foram reexecutados sem modificações no teste dedicado; reinício, SQLite íntegro/FKs e igualdade de snapshot/hash do PDF confirmados.

As regressões foram executadas sequencialmente e retomadas por suíte após os ajustes documentados abaixo; `regressoes-resultados.json` reúne todas as 10 suítes aprovadas e `regressoes-browser.txt` reúne seus trechos concluídos. Não houve nova execução da CI: não existe PR da branch integrada e o workflow somente valida pushes na main e PRs. Isto é validação local, não homologação produtiva.

## Pendências e revisão

A02–A09 (dados comerciais reais/instalação) continuam não verificados nesta tarefa: testes sintéticos não comprovam carga ou homologação produtiva. Não foi importado catálogo nem selecionado MR por padrão. Navegador móvel emulado não equivale a validação em aparelho físico/teclado virtual real. A geometria usa viewport dinâmica/safe-area, mas o ensaio em dispositivo físico permanece posterior.

Nenhuma reorganização de Mapa (Etapa 4) ou rodapé/Copiloto (Etapa 5) foi iniciada. Permanecem os botões/rotas atuais de prévia e histórico. Não houve mudança financeira, infraestrutura ou banco existente. A entrega precisa de auditoria antes da próxima etapa.

### Ajustes dos testes antigos

Quatro suítes tiveram somente adaptações às decisões de interface desta etapa: fechar o seletor modal antes de clicar no conteúdo de fundo (`etapa_b_navigation`, `issue12_inclusion`); comparar centros dos controles com alturas de toque distintas (`etapa_d_components`); esperar “Rascunho incompleto” em vez de travessão para serviço salvo sem dimensão (`pr17_auditoria`). Asserções de integridade, revisões, repetição de serviços, resposta perdida, conflitos, recuperação e histórico foram mantidas. O teste dedicado da Etapa 2 é idêntico à versão auditada.

O rodapé expandido conserva sua geometria anterior; pode ocupar grande parte da tela de 320 px. Reorganização do rodapé/Copiloto não faz parte desta etapa e permanece para a Etapa 5.
