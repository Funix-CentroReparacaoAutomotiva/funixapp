# FUNIX — build de candidatos HML

**Vigente em 24/11/2026:** apenas a etapa de build isolado permanece útil. O controlador de preparação/atualização remota, assinatura, journals e reconciliação foram descontinuados. Consulte [operação HML simplificada](HML_OPERACAO_ATUALIZADOR.md).

O workflow existente `.github/workflows/funix-hml-candidate.yml` (**FUNIX - Homologacao (candidato)**) é manual na main. Recebe `pr_number`, `revision` (SHA completo da PR interna revisada), `authorized` (autorização do build) e `web_target` (`web` ou `web-hml-painel`). Seleciona a revisão, testa, constrói API e Web e gera artefato privado `funix-hml-<revision>-<attempt>`, com `manifest.json` e `images.tar.gz`, retido por três dias. Não publica produção nem acessa VPS.

Use build de origem verificável e confirme CI e digest. O caminho de transferência de um novo pacote ainda precisa de validação via ferramentas conectadas; a atualização com imagens previamente presentes já foi comprovada. Não executar o workflow de assinatura de autorização legado, nem preparar ticket, journal ou reconciliação. A entrega utiliza Docker Compose HML diretamente pelo n8n, mediante autorização aplicável.
