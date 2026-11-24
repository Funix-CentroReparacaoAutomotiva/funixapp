# Identidade das imagens HML

O Docker/containerd pode apresentar ID local distinto do digest de configuração original do manifesto. A diferença, isoladamente, não prova corrupção. Na atualização real de 24/11/2026 (n8n 48345) a identidade das duas imagens foi validada pelo conteúdo e a implantação foi bem-sucedida.

Reutilizar `deploy/hml-image-identity.py`: resolver o ID selecionado uma vez, exportá-lo com `docker image save`, verificar configuração SHA-256 e camadas descomprimidas conforme os diff_ids do manifesto autenticado. Selecionar imagem imutável; label de revisão isolada não prova procedência. O resultado é o ID local efetivamente verificado, que pode ser aplicado no Compose HML.

Não depender de journal, controlador ou recovery legado para esse teste. Consulte [operação HML simplificada](HML_OPERACAO_ATUALIZADOR.md).
