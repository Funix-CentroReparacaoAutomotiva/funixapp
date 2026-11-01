# Evidências Etapa 6 — Issue #31

Todos os bancos e Atendimentos dos ensaios são temporários e sintéticos. Os arquivos `check.log`, `deploy-tests.log`, `regressions.log` e `integrated.log` registram execuções desta etapa. `RESULTADOS.json` resume os totais; `regressions/summary.json` discrimina cada suíte/assertiva e os demais JSON preservam geometria, pares e observações.

30 capturas selecionadas: `integrated/` contém Chat, Diagnósticos, editor e Mapa em 1440/390/320; `regressions/etapa4_mapa/` mostra as duas laterais com 13 categorias; `regressions/etapa5_rodape/` mostra painel recolhido e Copiloto aberto com painel expandido; `regressions/etapa3_editor/` mostra cards vazios e configuração pendente. Todas foram geradas novamente nesta etapa. Demais capturas completas permanecem no diretório local ignorado `.runtime/etapa6/regressions`, sem sobrescrever as evidências versionadas anteriores.

`origem-coda-readonly.json` é a única evidência de origem real: metadados, contagens e agregados de preenchimento/sinal de fatores e capacidade, sem preços, clientes ou credenciais. Não comprova carga no banco instalado. Os logs dos testes de importação usam exclusivamente fixtures sintéticas.

CI remota e SHA definitivo são registrados no PR draft e na Issue #31, depois da execução. Não foram feitos merge, deploy ou alterações na instalação.
