# Validação da investigação — 06/11/2026

- Base local e base remota main confirmadas: `b3244d1e9638cb683ff727099975a8b370bd81c3`.
- `python docs/investigacoes/issue67/recalcular.py`: aprovado. Confere 34 registros/30 pares distintos, correspondência CSV, URLs HTTPS, ausência de ofertas aceitas/chamadas autenticadas, 40 buscas totais ≤50 e dez verificações de abertura. Recalcula p50/p95 sem executar rede.
- `npm run check`: aprovado, **545 testes, 545 aprovados, zero falhas/ignorados**, build frontend, tipos backend e lint concluídos. Avisos preexistentes de lint em coda-import e componentes React; nenhum arquivo funcional foi alterado.
- Primeira execução no sandbox: 512 aprovados e 33 falhas por `listen EPERM` em testes HTTP locais. Reexecução com sockets locais permitidos terminou com exit code 0. Só fixtures sintéticas dos testes existentes; não foi acessado banco instalado ou serviço de produção.
- Mock HTML: estudo estático com quadros declarados 320/390/1440, SVG inline e botões desativados. Sem fetch, recurso externo, formulário de envio ou integração. **Não houve QA de navegador/screenshots desta entrega**; responsividade visual e acessibilidade completas permanecem para inspeção humana. O mock não simula revisão de servidor bem-sucedida.
- Métricas externas são exclusivamente da ferramenta de descoberta pública. Não foram executados testes autenticados de ML/Shopping nem se alegam cobertura/latência das APIs.
- Escopo de publicação: apenas `docs/investigacoes/issue67/`, em branch independente baseada em main, PR documental para revisão. Não modificar AGENTS, workflow, package, código do app ou infraestrutura. Não fechar a issue automaticamente: ainda há gates de acesso e aprovação.

Os logs completos de testes e respostas brutas foram mantidos em `work/` da sessão, fora da entrega. Os artefatos publicados contêm medições reduzidas, URLs e avaliações, sem copiar páginas integrais ou contatos incidentais retornados pelas fontes.
