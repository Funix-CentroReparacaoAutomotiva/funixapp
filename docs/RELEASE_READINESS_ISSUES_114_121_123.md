# FUNIX — Candidato à liberação: Issues #114, #121 e #123

**Estado:** pré-liberação para revisão. **Não há autorização para merge, publicação ou deploy.** Sem acesso aos dados de produção.

## Rastreabilidade

- #114 / PR #134: localizar serviços e componentes incompletos, sem alterar cálculos.
- #121 / PR #133: rascunho financeiro persistido por cenário; migração SQLite V15 e bloqueio do Copiloto enquanto houver autosave pendente.
- #123 / PR #135: prévia PDF mobile por gesto explícito, sem emissão até confirmação.
- PR #140: backup offline V14 e ensaio de restauração, sem alterar o deploy em execução.
- PR #138: integração sintética das quatro alterações sobre `main` de referência; **não realizar merge de uma PR designada como laboratório de QA**.

## Aceitação funcional obrigatória

1. Em desktop e mobile, entrar no Atendimento e localizar campos incompletos; não apresentar totais parciais como valores completos.
2. Alterar desconto e acréscimo de negociação, alternar cenários, recarregar, testar erro de rede/409 e confirmar que valores não desaparecem silenciosamente. **Nunca emitir enquanto persistência estiver pendente.**
3. Com valor financeiro em edição/salvamento, o Copiloto não inicia gravação; após confirmação no backend, gravação volta a ficar disponível com revisão atual.
4. Conferir prévia PDF nos navegadores móveis disponíveis, download/fallback, voltar/cancelar e confirmar. Antes de Confirmar, não pode haver número nem orçamento emitido; após confirmação, não repetir emissão por resposta duplicada.
5. Conferir leitura e hashes de orçamentos antigos e ausência de mudança indevida na composição/cálculo.
6. Validar regressão de Chat, Atualizações, voz e fluxos administrativos contra o `main` vigente.

## Go/no-go da infraestrutura: migração V15

- Verificar revision real, saúde, versão do esquema e layout de volumes **com autorização apropriada**.
- Definir responsável de execução, janela de parada, meios de comunicação e plano de recuperação com tempo de indisponibilidade aceitável.
- Testar a restauração com backup íntegro em ambiente isolado antes do corte e definir armazenamento de segunda cópia fora da VPS.
- Antes de iniciar a imagem V15, bloquear gravações e criar backup consistente do banco V14. A ferramenta de apoio está documentada em `docs/ISSUE121_SEGURANCA_MIGRACAO_V15.md`.
- O rollback atual de `deploy/funix-deploy` volta os contêineres, **não** desfaz migração SQLite. Após falha com V15, retorno exige **banco V14 e aplicação V14 como par**, com cópias, parada dos escritores e tratamento de `-wal`/`-shm` validado.
- Sem confirmação do backup e da restauração, **não implantar a #121**.
- Se a V15 não estiver pronta, considerar liberação separada de #114 e #123 após homologação e autorização de merge/publicação.

## Critérios para solicitar decisão da direção

Só apresentar para aprovação quando os checks integrados e de recuperação estiverem concluídos, a falha de voz resolvida ou classificada e explicitamente aceita, e houver evidência de homologação funcional. A aprovação deverá especificar **quais PRs**, autorização de **merge**, publicação de **imagens**, execução de **migração** e **deploy produtivo** separadamente.

Nenhuma execução produtiva é parte deste documento.