# HML — plano de recuperação do incidente 23/11/2026

**Status:** proposta de procedimento; **não é autorização operacional**.
**Escopo:** somente projeto Docker `funix-hml`, operação `op-45130103689-1-prep-14797367759`, VPS de homologação; produção/n8n fora do escopo.

## 1. Estado observado (evidências da direção / saída de scripts somente leitura)

- Journal ativo: `phase=restoring`, `previous.revision=54b60d98b6c39ff0dc8ada0f7daa60bcf6cf2325`; candidato `20a1a1561223a00ba4aec6290b55ddd9c0b52696`.
- Pedido remoto: `requires_recovery`, worker `failed`, sem `armed.json`.
- `backup.sqlite`, `restore.sqlite` e banco ativo com digest idêntico; SQLite `integrity_check` aprovado; sem arquivos auxiliares.
- API, Web e Gateway com saúde `healthy`; Gateway em manutenção no Traefik.
- Pré-validação oficial passou; durante o `recover` surgiu `HTTPS attempt=1 category=contract retry=false`, status de saída 1, journal permaneceu `restoring`.
- Posteriormente, o mesmo validador oficial passou; 25 probes HTTPS sem falha, sem alteração administrativa intermediária relatada.

**Hipótese ainda não comprovada:** borda TLS enviou 502/503/504 durante a recriação do Gateway. Pode ter sido outra divergência de contrato; o log atual não registra método/rota/status.

## 2. Revisão da correção em desenvolvimento

PR #346 adapta somente a interpretação de HTTP 502/503/504 inesperados como indisponibilidade transitória sob prazo global de 60 segundos. Preserva o limite anterior de três tentativas para falhas de transporte e mantém reprovação imediata de Basic/HTTPS/revisão inválidos. Inclui testes unitários e ensaio Docker com borda HTTPS sintética e falhas 502/503/504 imediatamente após recriar o Gateway.

**Não assumir que CI verde prova a causa na VPS.** O ensaio é em ambiente descartável e não observa o Traefik instalado.

## 3. Bloqueio de implantação / política de segurança

`deploy/remote-hml/migrate.py` exige `idle()`: worker inativo, journal terminal (`accepted` ou `restored`) e pedido remoto encerrado em estados permitidos. O incidente atual viola essas condições. Portanto **não usar o migrador regular para instalar a PR #346** enquanto houver pendência; **não alterar manualmente arquivos pinados**, certificados, journals, credenciais ou container labels.

Uma intervenção de recuperação excepcional exige mecanismo e aprovação separados, com revisão de segurança do modo de distribuição e execução. Não declarar a PR como automaticamente implantável.

## 4. Gate de autorização prévia para uma intervenção excepcional

1. CI completo verde no HEAD definitivo e revisão independente da mudança, especialmente da cadeia de pins `hml-update.py` → `control.py` → `rootctl.py`.
2. Evidência de que o executor excepcional atua **somente em HML** e não toca em produção, Traefik global ou outros contêineres; autorização específica da direção quanto a intervenção, janela e possível indisponibilidade.
3. Mecanismo de distribuição verificado por SHA-256 e fonte/commit exatos; staging privado e efêmero, sem substituir o código oficial instalado ou relaxar seus pins. Caso isso não seja tecnicamente verificável, **não executar**.
4. Antes da ação, revalidar sob controles apropriados: identidade/phase/pointer, digest do backup/staged/live, SQLite integrity/foreign keys, contêineres, ausência de writers, saúde do storage, saldo livre, exclusividade do lock e `armed.json` ausente.
5. Definir operação idempotente/única, isolamento e captura de saída sanitizada, e o que fazer se persistir em `restoring`. Nunca automatizar um segundo `recover`.
6. Revisar efeito explícito de `restore_database()`: **substitui o SQLite ativo** mesmo que antes tenha digest igual ao backup; nenhuma escrita posterior pode ser descartada silenciosamente.

## 5. Procedimento excepcional proposto — execução isolada, sem trocar código instalado

Este é um **desenho técnico sob revisão**, não um comando autorizado, e não foi testado na VPS. O caminho preferível preserva os 15 destinos pinados do controlador instalado, que o migrador regular não pode alterar enquanto `idle()` reprova a transação pendente.

1. Obter fora da VPS um checkout confiável do **commit SHA-40 explicitamente aprovado**, gerar `git -c core.autocrlf=false archive --format=tar <SHA> deploy` e validar o tar inteiro com `deploy/remote-hml/verify-migration-bundle.py`. Registrar hash SHA-256 do tar aprovado por canal independente. A verificação deve conferir `control.FILES` (12 blobs Git) e `rootctl.PREP_SHA`, rejeitar CRLF, symlinks e conteúdo que divergir.
2. Somente após aprovação de staging, transferir o tar para um diretório **novo e privado 0700, root-owned, de HML**, fora de diretórios do controlador instalado. Conferir SHA-256 externo antes de extração, propriedade, modos, nomes e ausência de caminhos fora de `deploy`; os módulos executáveis devem corresponder ao commit exato aprovado. Preservar o tar/evidências para auditoria; não tocar nos módulos pinados existentes.
3. Proceder a pré-voo independente **somente leitura** no host: validar `host_scope`, `check_config`, revisão anterior e candidata, ponteiro ativo, journal `restoring`, hashes e `integrity_check` do SQLite backup/staged/live, ausência de escritas posteriores, espaço livre, ausência de aprovação armada, worker não ativo, três contêineres HML saudáveis, Gateway restrito e ausência de acesso externo inesperado. Salvar um resumo sanitizado, sem mostrar credenciais/tokens/JSON de configuração.
4. Em janela aprovada, com acesso administrativo independente e suspensão de outros operadores, criar controle de execução única auditável **antes da mutação**. Executar somente uma vez, pelo `python3 -I -B` da distribuição autorizada, o **CLI `hml-update.py recover` existente** com `--operation` e `--config` exatos da operação fixa e `--authorize`. O import relativo de `hml-*.py` deve apontar exclusivamente para a árvore validada no passo 2. O CLI já aplica `host_scope`, `check_config`, `adapter.assert_contract`, lock da transação, restauração e validação. Não usar `update`, `rollback`, migração do controlador ou outras operações.
5. **Ainda exige prova antes de autorização real:** executar, em runner descartável, este formato de carregamento isolado e o CLI `recover` após interrupção, garantindo que os módulos oficiais instalados e os locks de outros serviços permaneçam intocados. O ensaio Docker da PR #346 valida transação e HTTPS, mas **não é prova** de distribuição/executabilidade do bundle na VPS; uma validação independente deve revisar a fronteira.
6. Após a execução, registrar journal, revisão, banco, modo do Gateway, saúde, HTTPS normal e conservação de contêineres externos. Se o CLI falhar ou a saída for ambígua, **não repetir** nem apagar o controle de execução; reclassificar e rever. Só após recuperar o FunixApp tratar, em processo distinto, o pedido remoto persistente `requires_recovery`.

**Riscos explícitos:** este procedimento é uma **exceção ao caminho de instalação governado**, não uma atualização do controlador; requer autorização ainda não concedida. Mesmo quando o banco ativo coincide com o backup, `recover` substitui o SQLite. A correção cobre indisponibilidade HTTP transitória identificada em ensaio, mas outro erro de contrato (por exemplo, 401 por credencial divergente após recriação) continuará bloqueando o procedimento, como deve. A aprovação deve reconhecer essa possibilidade sem autorizar tentativas sucessivas.

## 6. Critérios de conclusão

- Journal `restored`, `active.json` coerente, digest do banco ativo igual ao backup preservado.
- Docker `api`, `web`, `gateway` na revisão anterior aprovada, saudáveis e com isolamento/mounts esperados.
- HTTPS normal com login habitual, release e revision corretos; `/painel/` acessível sob credenciais normais; exigência de Basic mantida; rotas de escrita permitidas somente conforme política normal. Conferir que manutenção foi retirada sem afrouxar segurança.
- Cópia `failed-database`, outros contêineres externos, journals e backups preservados; relatório sanitizado.
- Pedido remoto `requires_recovery` **continua pendente** após resolver a transação local. Conciliação administrativa posterior deve preservar histórico, não fazer replay e requer procedimento aprovado.
- Somente após ambos os estados regulares, planejar próximo candidato HML / painel CTO com aprovação separada.

## 7. Contenção se falhar

Parar, preservar logs/journals e não rearmar nem repetir a transação. Proibir alterações ad hoc de Compose, Traefik, banco, pins ou permissões. Submeter o estado real e a evidência de falha para revisão independente antes de qualquer plano alternativo.

**Controle de escopo:** sem merge, deploy, escrita na VPS ou alteração de produção por este documento.
