# Issue #70 — quatro canais de pesquisa, com Montadora condicional

Decisão funcional de 08/11/2026: exibir **Geral | Original | Oficial | Montadora**. Os três primeiros permanecem na interface; **Montadora** aparece apenas para marcas com e-commerce direto de peças verificado. A mesma regra vale para Diagnóstico (somente componente selecionado) e Copiloto (opções visíveis com o componente em revisão).

- **Geral:** Google Shopping com marca, modelo, ano inequívoco e descrição técnica.
- **Original:** mesma pesquisa no Google Shopping acrescida do termo `original` (não certifica autenticidade).
- **Oficial:** loja oficial da marca dentro do Mercado Livre, quando conhecida e cadastrada; caso contrário, opção indisponível. Não usar lojas genéricas, concessionárias independentes ou vendedores não certificados.
- **Montadora:** e-commerce próprio de peças da marca, quando comprovado. Não exibir para marcas sem canal de venda direta verificado.
- **Volkswagen:** Oficial = `https://www.mercadolivre.com.br/loja/volkswagen/pecas-e-acessorios`; Montadora = `https://pecas.vw.com.br/`. Ambos os canais são divulgados pela própria Volkswagen: `https://www.vw.com.br/pt/servicos-e-acessorios/reparadoresvw.html`.
- Demais canais do Mercado Livre: Chevrolet, Fiat, Jeep, Ford e Renault mantêm os mapeamentos preexistentes até auditoria individual de URLs. A inclusão do quarto botão para outras marcas dependerá de verificação da venda direta; não presumir que página de serviços ou catálogo seja e-commerce.
- Sem mudança de dados, preço, MR, aplicação de orçamento, consultas pagas, backend de cotação, ledger ou flags.

Limitação: o clique em **Oficial** ou **Montadora** abre a respectiva página de loja, não garante uma pesquisa filtrada pelo componente, nem compatibilidade ou equivalência de preços. A melhoria de navegação dentro do canal é assunto separado.

Validar testes unitários e Chromium em 320/390/1440, três versus quatro botões, sem buscas automáticas, sem PII nas URLs. Entrega em PR, sem merge/deploy automáticos nesta etapa.
