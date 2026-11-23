# Issue #256 — Revisão de escopo e comparação autenticada

A consulta autenticada retorna catálogo ativo e revisão do Atendimento; POST /importar-cilia/comparar recebe bytes originais, volante, revisão e mapeamento explícito. A placa deve coincidir, sem presumir autorização. O servidor reinterpreta XML, valida escopo e usa a configuração financeira vigente. Não aceita valor final calculado pelo cliente. Nenhuma mutação.

Interface: atribuição de peças, diagnóstico/intensidade opcionais, agrupamento explícito por operação, alternativas de serviço/dimensão/quantidade e justificativas, revisão e cálculo. Pendências ou mudanças invalidam a comparação visível. As opções são hipóteses técnicas, sem aprovação automática. Sem gravação/produção. Testes de contrato adicionados, CI necessário. A consulta e comparação ficam na mesma flag OFF.
