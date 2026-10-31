# FUNIX — Matriz proposta dos 163 códigos

**PROPOSTA NÃO APLICADA.** Base main `b0fdba268bc9250a04267e3d313c3eca26c625c5`. Nenhuma alteração no aplicativo, catálogo, banco ou infraestrutura. Não é uma carga comercial.

## Cobertura

| Região proposta | Códigos | Categorias no primeiro nível |
|---|---:|---:|
| Frente | 27 | 8 |
| Estrutura dianteira | 7 | 5 |
| Motorista | 40 | 13 |
| Passageiro | 40 | 13 |
| Traseira | 27 | 8 |
| Estrutura traseira | 10 | 7 |
| Topo | 12 | 4 |

Os nomes originais e códigos estão preservados no CSV/Excel. Rótulos propostos são somente navegação. A matriz apresenta exatamente um caminho por código; os casos em decisão continuam provisórios. As ações Ambos são referências a dois códigos existentes, não registros adicionais.

## Decisões necessárias

### D01 — Colunas genéricas

Proposta: Manter os dois códigos com caminho provisório de identificação pendente, sem renomear cadastro nem converter para A/B/C.

Decisão: Escolher acesso alternativo (por exemplo busca/classificação funcional) ou manutenção temporária de acesso no mapa. Remover a opção de toda navegação e preservar os 163 acessíveis conflita sem essa decisão.

Códigos: `coluna_generica__motorista`, `coluna_generica__passageiro`

### D02 — Caixa de roda sem eixo

Proposta: Manter separado como Sem eixo especificado dentro de Caixa de roda, somente como hipótese para revisão. Ambos usa dianteira+traseira e exclui o genérico.

Decisão: Confirmar se o genérico representa peça distinta ou cadastro a identificar. Nenhuma fusão/conversão autorizada.

Códigos: `caixa_roda_generica__motorista`, `caixa_roda_generica__passageiro`

### D03 — Estrutura, vidros e itens internos

Proposta: Separar as áreas visuais Estrutura dianteira/traseira do SVG por identificadores, sem mudar paths; vidros são agrupamento de navegação, não reclassificação técnica. Painel lateral interno tem acesso lateral.

Decisão: Aprovar os agrupamentos listados, especialmente vidro traseiro/interior porta-malas/painel lateral; frente e traseira hoje compartilham identificadores com Estrutura.

Códigos: `cofre_motor_dianteiro`, `longarina_dianteira__motorista`, `longarina_dianteira__passageiro`, `painel_dianteiro`, `travessa_do_radiador`, `para_brisa`, `vidro_dianteiro_outro`, `painel_lateral_interno__motorista`, `painel_lateral_interno__passageiro`, `assoalho_porta_malas`, `bojo_estepe`, `cofre_motor_traseiro`, `longarina_traseira__motorista`, `longarina_traseira__passageiro`, `painel_traseiro`, `acabamentos_porta_malas`, `interno_porta_malas`, `moldura_porta_malas`, `vidro_traseiro`

### D04 — Soleiras

Proposta: Acessórios e acabamentos da lateral, mantendo código/nome/identidade.

Decisão: Confirmar se o cadastro significa acabamento ou elemento estrutural para escolher a categoria.

Códigos: `soleira__motorista`, `soleira__passageiro`

### D05 — Capacidade do primeiro nível radial

Proposta: Todas as categorias iniciais visíveis; nenhum Ver mais na raiz; geometria original do SVG preservada.

Decisão: Validar legibilidade em 320 px com 13 categorias nas laterais. Se houver colisão, apresentar ajuste visual para revisão em etapa futura, sem ocultar categorias automaticamente.

Códigos: Questão de apresentação; não cria/exclui código.

## Caminhos propostos

| Código original | Região | Categoria | Posição/lado | Caminho canônico proposto | Decisão |
|---|---|---|---|---|---|
| `acabamentos_plasticos_dianteiros` | Frente | Acabamentos dianteiros | comum / Dianteiro | Frente > Acabamentos dianteiros > Acabamentos plásticos dianteiros | Aprovar proposta |
| `adesivos_dianteiros` | Frente | Acabamentos dianteiros | comum / Dianteiro | Frente > Acabamentos dianteiros > Adesivos dianteiros | Aprovar proposta |
| `churrasqueira` | Frente | Acabamentos dianteiros | comum / Dianteiro | Frente > Acabamentos dianteiros > Churrasqueira (base do para-brisa) | Aprovar proposta |
| `frisos_dianteiros` | Frente | Acabamentos dianteiros | comum / Dianteiro | Frente > Acabamentos dianteiros > Frisos dianteiros | Aprovar proposta |
| `moldura_dianteira_generica` | Frente | Acabamentos dianteiros | comum / Dianteiro | Frente > Acabamentos dianteiros > Moldura dianteira (genérica) | Aprovar proposta |
| `alma_para_choque_dianteiro` | Frente | Alma do para-choque dianteiro | comum / Dianteiro | Frente > Alma do para-choque dianteiro | Aprovar proposta |
| `capo` | Frente | Capô | comum / Dianteiro | Frente > Capô | Aprovar proposta |
| `defletor_inferior_dianteiro` | Frente | Complementos dianteiros | comum / Dianteiro | Frente > Complementos dianteiros > Defletor inferior dianteiro | Aprovar proposta |
| `difusor_dianteiro` | Frente | Complementos dianteiros | comum / Dianteiro | Frente > Complementos dianteiros > Difusor dianteiro | Aprovar proposta |
| `spoiler_dianteiro` | Frente | Complementos dianteiros | comum / Dianteiro | Frente > Complementos dianteiros > Spoiler dianteiro | Aprovar proposta |
| `grade_dianteira` | Frente | Grades e entradas de ar | comum / Dianteiro | Frente > Grades e entradas de ar > Grade dianteira | Aprovar proposta |
| `grade_inferior__motorista` | Frente | Grades e entradas de ar | motorista / Dianteiro | Frente > Grades e entradas de ar > Grade inferior > Motorista | Aprovar proposta |
| `grade_inferior__passageiro` | Frente | Grades e entradas de ar | passageiro / Dianteiro | Frente > Grades e entradas de ar > Grade inferior > Passageiro | Aprovar proposta |
| `grade_inferior_central` | Frente | Grades e entradas de ar | comum / Dianteiro | Frente > Grades e entradas de ar > Grade inferior central / inteiriça | Aprovar proposta |
| `grade_lateral__motorista` | Frente | Grades e entradas de ar | motorista / Dianteiro | Frente > Grades e entradas de ar > Grade lateral > Motorista | Aprovar proposta |
| `grade_lateral__passageiro` | Frente | Grades e entradas de ar | passageiro / Dianteiro | Frente > Grades e entradas de ar > Grade lateral > Passageiro | Aprovar proposta |
| `alojamento_farol__motorista` | Frente | Iluminação dianteira | motorista / Dianteiro | Frente > Iluminação dianteira > Alojamento do farol > Motorista | Aprovar proposta |
| `alojamento_farol__passageiro` | Frente | Iluminação dianteira | passageiro / Dianteiro | Frente > Iluminação dianteira > Alojamento do farol > Passageiro | Aprovar proposta |
| `farol__motorista` | Frente | Iluminação dianteira | motorista / Dianteiro | Frente > Iluminação dianteira > Farol > Motorista | Aprovar proposta |
| `farol__passageiro` | Frente | Iluminação dianteira | passageiro / Dianteiro | Frente > Iluminação dianteira > Farol > Passageiro | Aprovar proposta |
| `farol_milha__motorista` | Frente | Iluminação dianteira | motorista / Dianteiro | Frente > Iluminação dianteira > Farol de milha > Motorista | Aprovar proposta |
| `farol_milha__passageiro` | Frente | Iluminação dianteira | passageiro / Dianteiro | Frente > Iluminação dianteira > Farol de milha > Passageiro | Aprovar proposta |
| `moldura_farol_milha__motorista` | Frente | Iluminação dianteira | motorista / Dianteiro | Frente > Iluminação dianteira > Moldura do farol de milha > Motorista | Aprovar proposta |
| `moldura_farol_milha__passageiro` | Frente | Iluminação dianteira | passageiro / Dianteiro | Frente > Iluminação dianteira > Moldura do farol de milha > Passageiro | Aprovar proposta |
| `para_choque_dianteiro` | Frente | Para-choque dianteiro | comum / Dianteiro | Frente > Para-choque dianteiro | Aprovar proposta |
| `sensor_estacionamento_dianteiro__motorista` | Frente | Sensor de estacionamento | motorista / Dianteiro | Frente > Sensor de estacionamento > Motorista | Aprovar proposta |
| `sensor_estacionamento_dianteiro__passageiro` | Frente | Sensor de estacionamento | passageiro / Dianteiro | Frente > Sensor de estacionamento > Passageiro | Aprovar proposta |
| `cofre_motor_dianteiro` | Estrutura dianteira | Estrutura dianteira | comum / Dianteiro | Estrutura dianteira > Cofre do motor dianteiro | D03 |
| `longarina_dianteira__motorista` | Estrutura dianteira | Estrutura dianteira | motorista / Dianteiro | Estrutura dianteira > Longarina dianteira > Motorista | D03 |
| `longarina_dianteira__passageiro` | Estrutura dianteira | Estrutura dianteira | passageiro / Dianteiro | Estrutura dianteira > Longarina dianteira > Passageiro | D03 |
| `painel_dianteiro` | Estrutura dianteira | Estrutura dianteira | comum / Dianteiro | Estrutura dianteira > Painel dianteiro | D03 |
| `travessa_do_radiador` | Estrutura dianteira | Estrutura dianteira | comum / Dianteiro | Estrutura dianteira > Travessa do radiador | D03 |
| `para_brisa` | Estrutura dianteira | Vidros dianteiros | comum / Dianteiro | Estrutura dianteira > Vidros dianteiros > Para-brisa | D03 |
| `vidro_dianteiro_outro` | Estrutura dianteira | Vidros dianteiros | comum / Dianteiro | Estrutura dianteira > Vidros dianteiros > Vidro dianteiro (outro) | D03 |
| `alojamento_portinhola_combustivel__motorista` | Motorista | Abastecimento | motorista / Não especificada | Motorista > Abastecimento > Alojamento da portinhola | Aprovar proposta |
| `portinhola_combustivel__motorista` | Motorista | Abastecimento | motorista / Não especificada | Motorista > Abastecimento > Portinhola de combustível | Aprovar proposta |
| `acabamentos_plasticos_laterais__motorista` | Motorista | Acessórios e acabamentos | motorista / Não especificada | Motorista > Acessórios e acabamentos > Acabamentos plásticos laterais | Aprovar proposta |
| `adesivos_laterais__motorista` | Motorista | Acessórios e acabamentos | motorista / Não especificada | Motorista > Acessórios e acabamentos > Adesivos laterais | Aprovar proposta |
| `frisos_laterais__motorista` | Motorista | Acessórios e acabamentos | motorista / Não especificada | Motorista > Acessórios e acabamentos > Frisos laterais | Aprovar proposta |
| `moldura_lateral__motorista` | Motorista | Acessórios e acabamentos | motorista / Não especificada | Motorista > Acessórios e acabamentos > Moldura lateral | Aprovar proposta |
| `rack_lateral__motorista` | Motorista | Acessórios e acabamentos | motorista / Não especificada | Motorista > Acessórios e acabamentos > Rack lateral | Aprovar proposta |
| `soleira__motorista` | Motorista | Acessórios e acabamentos | motorista / Não especificada | Motorista > Acessórios e acabamentos > Soleira | D04 |
| `spoiler_lateral__motorista` | Motorista | Acessórios e acabamentos | motorista / Não especificada | Motorista > Acessórios e acabamentos > Spoiler lateral | Aprovar proposta |
| `caixa_roda_dianteira__motorista` | Motorista | Caixa de roda | motorista / Dianteiro | Motorista > Caixa de roda > Dianteiro | Aprovar proposta |
| `caixa_roda_generica__motorista` | Motorista | Caixa de roda | motorista / Sem eixo especificado | Motorista > Caixa de roda > Sem eixo especificado | D02 |
| `caixa_roda_traseira__motorista` | Motorista | Caixa de roda | motorista / Traseiro | Motorista > Caixa de roda > Traseiro | Aprovar proposta |
| `friso_porta_dianteira__motorista` | Motorista | Componentes das portas | motorista / Dianteiro | Motorista > Componentes das portas > Porta dianteira > Friso | Aprovar proposta |
| `macaneta_dianteira__motorista` | Motorista | Componentes das portas | motorista / Dianteiro | Motorista > Componentes das portas > Porta dianteira > Maçaneta | Aprovar proposta |
| `moldura_porta_dianteira__motorista` | Motorista | Componentes das portas | motorista / Dianteiro | Motorista > Componentes das portas > Porta dianteira > Moldura | Aprovar proposta |
| `interno_porta_dianteira__motorista` | Motorista | Componentes das portas | motorista / Dianteiro | Motorista > Componentes das portas > Porta dianteira > Parte interna | Aprovar proposta |
| `vidro_porta_dianteira__motorista` | Motorista | Componentes das portas | motorista / Dianteiro | Motorista > Componentes das portas > Porta dianteira > Vidro | Aprovar proposta |
| `friso_porta_traseira__motorista` | Motorista | Componentes das portas | motorista / Traseiro | Motorista > Componentes das portas > Porta traseira > Friso | Aprovar proposta |
| `macaneta_traseira__motorista` | Motorista | Componentes das portas | motorista / Traseiro | Motorista > Componentes das portas > Porta traseira > Maçaneta | Aprovar proposta |
| `moldura_porta_traseira__motorista` | Motorista | Componentes das portas | motorista / Traseiro | Motorista > Componentes das portas > Porta traseira > Moldura | Aprovar proposta |
| `interno_porta_traseira__motorista` | Motorista | Componentes das portas | motorista / Traseiro | Motorista > Componentes das portas > Porta traseira > Parte interna | Aprovar proposta |
| `vidro_porta_traseira__motorista` | Motorista | Componentes das portas | motorista / Traseiro | Motorista > Componentes das portas > Porta traseira > Vidro | Aprovar proposta |
| `retrovisor__motorista` | Motorista | Componentes das portas | motorista / Não especificada | Motorista > Componentes das portas > Retrovisor | Aprovar proposta |
| `caixa_de_ar__motorista` | Motorista | Estrutura lateral | motorista / Não especificada | Motorista > Estrutura lateral > Caixa de ar | Aprovar proposta |
| `coluna_a__motorista` | Motorista | Estrutura lateral | motorista / Dianteiro | Motorista > Estrutura lateral > Colunas > Coluna A (dianteira) | Aprovar proposta |
| `coluna_b__motorista` | Motorista | Estrutura lateral | motorista / Central | Motorista > Estrutura lateral > Colunas > Coluna B (central) | Aprovar proposta |
| `coluna_c__motorista` | Motorista | Estrutura lateral | motorista / Traseiro | Motorista > Estrutura lateral > Colunas > Coluna C (traseira) | Aprovar proposta |
| `coluna_generica__motorista` | Motorista | Estrutura lateral | motorista / Não identificada | Motorista > Estrutura lateral > Identificação pendente > Coluna (genérica) | D01 |
| `painel_lateral_interno__motorista` | Motorista | Estrutura lateral | motorista / Não especificada | Motorista > Estrutura lateral > Painel lateral interno | D03 |
| `lateral_traseira__motorista` | Motorista | Lateral traseira | motorista / Traseiro | Motorista > Lateral traseira | Aprovar proposta |
| `para_barro_dianteiro__motorista` | Motorista | Para-barro | motorista / Dianteiro | Motorista > Para-barro > Dianteiro | Aprovar proposta |
| `para_barro_traseiro__motorista` | Motorista | Para-barro | motorista / Traseiro | Motorista > Para-barro > Traseiro | Aprovar proposta |
| `para_lama_dianteiro__motorista` | Motorista | Para-lama | motorista / Dianteiro | Motorista > Para-lama | Aprovar proposta |
| `pinca_freio_dianteira__motorista` | Motorista | Pinça de freio | motorista / Dianteiro | Motorista > Pinça de freio > Dianteiro | Aprovar proposta |
| `pinca_freio_traseira__motorista` | Motorista | Pinça de freio | motorista / Traseiro | Motorista > Pinça de freio > Traseiro | Aprovar proposta |
| `porta_carga_lateral__motorista` | Motorista | Porta de carga lateral | motorista / Não especificada | Motorista > Porta de carga lateral | Aprovar proposta |
| `porta_dianteira__motorista` | Motorista | Porta dianteira | motorista / Dianteiro | Motorista > Porta dianteira | Aprovar proposta |
| `porta_traseira__motorista` | Motorista | Porta traseira | motorista / Traseiro | Motorista > Porta traseira | Aprovar proposta |
| `roda_dianteira__motorista` | Motorista | Roda | motorista / Dianteiro | Motorista > Roda > Dianteiro | Aprovar proposta |
| `roda_traseira__motorista` | Motorista | Roda | motorista / Traseiro | Motorista > Roda > Traseiro | Aprovar proposta |
| `alojamento_portinhola_combustivel__passageiro` | Passageiro | Abastecimento | passageiro / Não especificada | Passageiro > Abastecimento > Alojamento da portinhola | Aprovar proposta |
| `portinhola_combustivel__passageiro` | Passageiro | Abastecimento | passageiro / Não especificada | Passageiro > Abastecimento > Portinhola de combustível | Aprovar proposta |
| `acabamentos_plasticos_laterais__passageiro` | Passageiro | Acessórios e acabamentos | passageiro / Não especificada | Passageiro > Acessórios e acabamentos > Acabamentos plásticos laterais | Aprovar proposta |
| `adesivos_laterais__passageiro` | Passageiro | Acessórios e acabamentos | passageiro / Não especificada | Passageiro > Acessórios e acabamentos > Adesivos laterais | Aprovar proposta |
| `frisos_laterais__passageiro` | Passageiro | Acessórios e acabamentos | passageiro / Não especificada | Passageiro > Acessórios e acabamentos > Frisos laterais | Aprovar proposta |
| `moldura_lateral__passageiro` | Passageiro | Acessórios e acabamentos | passageiro / Não especificada | Passageiro > Acessórios e acabamentos > Moldura lateral | Aprovar proposta |
| `rack_lateral__passageiro` | Passageiro | Acessórios e acabamentos | passageiro / Não especificada | Passageiro > Acessórios e acabamentos > Rack lateral | Aprovar proposta |
| `soleira__passageiro` | Passageiro | Acessórios e acabamentos | passageiro / Não especificada | Passageiro > Acessórios e acabamentos > Soleira | D04 |
| `spoiler_lateral__passageiro` | Passageiro | Acessórios e acabamentos | passageiro / Não especificada | Passageiro > Acessórios e acabamentos > Spoiler lateral | Aprovar proposta |
| `caixa_roda_dianteira__passageiro` | Passageiro | Caixa de roda | passageiro / Dianteiro | Passageiro > Caixa de roda > Dianteiro | Aprovar proposta |
| `caixa_roda_generica__passageiro` | Passageiro | Caixa de roda | passageiro / Sem eixo especificado | Passageiro > Caixa de roda > Sem eixo especificado | D02 |
| `caixa_roda_traseira__passageiro` | Passageiro | Caixa de roda | passageiro / Traseiro | Passageiro > Caixa de roda > Traseiro | Aprovar proposta |
| `friso_porta_dianteira__passageiro` | Passageiro | Componentes das portas | passageiro / Dianteiro | Passageiro > Componentes das portas > Porta dianteira > Friso | Aprovar proposta |
| `macaneta_dianteira__passageiro` | Passageiro | Componentes das portas | passageiro / Dianteiro | Passageiro > Componentes das portas > Porta dianteira > Maçaneta | Aprovar proposta |
| `moldura_porta_dianteira__passageiro` | Passageiro | Componentes das portas | passageiro / Dianteiro | Passageiro > Componentes das portas > Porta dianteira > Moldura | Aprovar proposta |
| `interno_porta_dianteira__passageiro` | Passageiro | Componentes das portas | passageiro / Dianteiro | Passageiro > Componentes das portas > Porta dianteira > Parte interna | Aprovar proposta |
| `vidro_porta_dianteira__passageiro` | Passageiro | Componentes das portas | passageiro / Dianteiro | Passageiro > Componentes das portas > Porta dianteira > Vidro | Aprovar proposta |
| `friso_porta_traseira__passageiro` | Passageiro | Componentes das portas | passageiro / Traseiro | Passageiro > Componentes das portas > Porta traseira > Friso | Aprovar proposta |
| `macaneta_traseira__passageiro` | Passageiro | Componentes das portas | passageiro / Traseiro | Passageiro > Componentes das portas > Porta traseira > Maçaneta | Aprovar proposta |
| `moldura_porta_traseira__passageiro` | Passageiro | Componentes das portas | passageiro / Traseiro | Passageiro > Componentes das portas > Porta traseira > Moldura | Aprovar proposta |
| `interno_porta_traseira__passageiro` | Passageiro | Componentes das portas | passageiro / Traseiro | Passageiro > Componentes das portas > Porta traseira > Parte interna | Aprovar proposta |
| `vidro_porta_traseira__passageiro` | Passageiro | Componentes das portas | passageiro / Traseiro | Passageiro > Componentes das portas > Porta traseira > Vidro | Aprovar proposta |
| `retrovisor__passageiro` | Passageiro | Componentes das portas | passageiro / Não especificada | Passageiro > Componentes das portas > Retrovisor | Aprovar proposta |
| `caixa_de_ar__passageiro` | Passageiro | Estrutura lateral | passageiro / Não especificada | Passageiro > Estrutura lateral > Caixa de ar | Aprovar proposta |
| `coluna_a__passageiro` | Passageiro | Estrutura lateral | passageiro / Dianteiro | Passageiro > Estrutura lateral > Colunas > Coluna A (dianteira) | Aprovar proposta |
| `coluna_b__passageiro` | Passageiro | Estrutura lateral | passageiro / Central | Passageiro > Estrutura lateral > Colunas > Coluna B (central) | Aprovar proposta |
| `coluna_c__passageiro` | Passageiro | Estrutura lateral | passageiro / Traseiro | Passageiro > Estrutura lateral > Colunas > Coluna C (traseira) | Aprovar proposta |
| `coluna_generica__passageiro` | Passageiro | Estrutura lateral | passageiro / Não identificada | Passageiro > Estrutura lateral > Identificação pendente > Coluna (genérica) | D01 |
| `painel_lateral_interno__passageiro` | Passageiro | Estrutura lateral | passageiro / Não especificada | Passageiro > Estrutura lateral > Painel lateral interno | D03 |
| `lateral_traseira__passageiro` | Passageiro | Lateral traseira | passageiro / Traseiro | Passageiro > Lateral traseira | Aprovar proposta |
| `para_barro_dianteiro__passageiro` | Passageiro | Para-barro | passageiro / Dianteiro | Passageiro > Para-barro > Dianteiro | Aprovar proposta |
| `para_barro_traseiro__passageiro` | Passageiro | Para-barro | passageiro / Traseiro | Passageiro > Para-barro > Traseiro | Aprovar proposta |
| `para_lama_dianteiro__passageiro` | Passageiro | Para-lama | passageiro / Dianteiro | Passageiro > Para-lama | Aprovar proposta |
| `pinca_freio_dianteira__passageiro` | Passageiro | Pinça de freio | passageiro / Dianteiro | Passageiro > Pinça de freio > Dianteiro | Aprovar proposta |
| `pinca_freio_traseira__passageiro` | Passageiro | Pinça de freio | passageiro / Traseiro | Passageiro > Pinça de freio > Traseiro | Aprovar proposta |
| `porta_carga_lateral__passageiro` | Passageiro | Porta de carga lateral | passageiro / Não especificada | Passageiro > Porta de carga lateral | Aprovar proposta |
| `porta_dianteira__passageiro` | Passageiro | Porta dianteira | passageiro / Dianteiro | Passageiro > Porta dianteira | Aprovar proposta |
| `porta_traseira__passageiro` | Passageiro | Porta traseira | passageiro / Traseiro | Passageiro > Porta traseira | Aprovar proposta |
| `roda_dianteira__passageiro` | Passageiro | Roda | passageiro / Dianteiro | Passageiro > Roda > Dianteiro | Aprovar proposta |
| `roda_traseira__passageiro` | Passageiro | Roda | passageiro / Traseiro | Passageiro > Roda > Traseiro | Aprovar proposta |
| `acabamentos_plasticos_traseiros` | Traseira | Acabamentos traseiros | comum / Traseiro | Traseira > Acabamentos traseiros > Acabamentos plásticos traseiros | Aprovar proposta |
| `adesivos_porta_malas` | Traseira | Acabamentos traseiros | comum / Traseiro | Traseira > Acabamentos traseiros > Adesivos do porta-malas | Aprovar proposta |
| `adesivos_traseiros` | Traseira | Acabamentos traseiros | comum / Traseiro | Traseira > Acabamentos traseiros > Adesivos traseiros | Aprovar proposta |
| `frisos_traseiros` | Traseira | Acabamentos traseiros | comum / Traseiro | Traseira > Acabamentos traseiros > Frisos traseiros | Aprovar proposta |
| `moldura_traseira_generica` | Traseira | Acabamentos traseiros | comum / Traseiro | Traseira > Acabamentos traseiros > Moldura traseira (genérica) | Aprovar proposta |
| `alma_para_choque_traseiro` | Traseira | Alma do para-choque traseiro | comum / Traseiro | Traseira > Alma do para-choque traseiro | Aprovar proposta |
| `aerofolio` | Traseira | Complementos traseiros | comum / Traseiro | Traseira > Complementos traseiros > Aerofólio | Aprovar proposta |
| `defletor_inferior_traseiro` | Traseira | Complementos traseiros | comum / Traseiro | Traseira > Complementos traseiros > Defletor inferior traseiro | Aprovar proposta |
| `difusor_traseiro` | Traseira | Complementos traseiros | comum / Traseiro | Traseira > Complementos traseiros > Difusor traseiro | Aprovar proposta |
| `grade_traseira` | Traseira | Complementos traseiros | comum / Traseiro | Traseira > Complementos traseiros > Grade traseira | Aprovar proposta |
| `ponteira_para_choque_traseiro__motorista` | Traseira | Complementos traseiros | motorista / Traseiro | Traseira > Complementos traseiros > Ponteira do para-choque traseiro > Motorista | Aprovar proposta |
| `ponteira_para_choque_traseiro__passageiro` | Traseira | Complementos traseiros | passageiro / Traseiro | Traseira > Complementos traseiros > Ponteira do para-choque traseiro > Passageiro | Aprovar proposta |
| `spoiler_traseiro` | Traseira | Complementos traseiros | comum / Traseiro | Traseira > Complementos traseiros > Spoiler traseiro | Aprovar proposta |
| `alojamento_lanterna_traseira__motorista` | Traseira | Iluminação traseira | motorista / Traseiro | Traseira > Iluminação traseira > Alojamento da lanterna > Motorista | Aprovar proposta |
| `alojamento_lanterna_traseira__passageiro` | Traseira | Iluminação traseira | passageiro / Traseiro | Traseira > Iluminação traseira > Alojamento da lanterna > Passageiro | Aprovar proposta |
| `lanterna_central` | Traseira | Iluminação traseira | comum / Traseiro | Traseira > Iluminação traseira > Lanterna central | Aprovar proposta |
| `lanterna_re__motorista` | Traseira | Iluminação traseira | motorista / Traseiro | Traseira > Iluminação traseira > Lanterna de ré > Motorista | Aprovar proposta |
| `lanterna_re__passageiro` | Traseira | Iluminação traseira | passageiro / Traseiro | Traseira > Iluminação traseira > Lanterna de ré > Passageiro | Aprovar proposta |
| `lanterna_traseira__motorista` | Traseira | Iluminação traseira | motorista / Traseiro | Traseira > Iluminação traseira > Lanterna traseira > Motorista | Aprovar proposta |
| `lanterna_traseira__passageiro` | Traseira | Iluminação traseira | passageiro / Traseiro | Traseira > Iluminação traseira > Lanterna traseira > Passageiro | Aprovar proposta |
| `luz_placa` | Traseira | Iluminação traseira | comum / Traseiro | Traseira > Iluminação traseira > Luz de placa | Aprovar proposta |
| `lampada_luz_placa` | Traseira | Iluminação traseira | comum / Traseiro | Traseira > Iluminação traseira > Lâmpada da luz de placa | Aprovar proposta |
| `para_choque_traseiro` | Traseira | Para-choque traseiro | comum / Traseiro | Traseira > Para-choque traseiro | Aprovar proposta |
| `porta_carga_traseira` | Traseira | Porta de carga traseira | comum / Traseiro | Traseira > Porta de carga traseira | Aprovar proposta |
| `sensor_estacionamento_traseiro__motorista` | Traseira | Sensor de estacionamento | motorista / Traseiro | Traseira > Sensor de estacionamento > Motorista | Aprovar proposta |
| `sensor_estacionamento_traseiro__passageiro` | Traseira | Sensor de estacionamento | passageiro / Traseiro | Traseira > Sensor de estacionamento > Passageiro | Aprovar proposta |
| `tampa_porta_malas` | Traseira | Tampa do porta-malas | comum / Traseiro | Traseira > Tampa do porta-malas | Aprovar proposta |
| `assoalho_porta_malas` | Estrutura traseira | Estrutura traseira | comum / Traseiro | Estrutura traseira > Assoalho do porta-malas | D03 |
| `bojo_estepe` | Estrutura traseira | Estrutura traseira | comum / Traseiro | Estrutura traseira > Bojo / caixa do estepe | D03 |
| `cofre_motor_traseiro` | Estrutura traseira | Estrutura traseira | comum / Traseiro | Estrutura traseira > Cofre do motor traseiro | D03 |
| `longarina_traseira__motorista` | Estrutura traseira | Estrutura traseira | motorista / Traseiro | Estrutura traseira > Longarina traseira > Motorista | D03 |
| `longarina_traseira__passageiro` | Estrutura traseira | Estrutura traseira | passageiro / Traseiro | Estrutura traseira > Longarina traseira > Passageiro | D03 |
| `painel_traseiro` | Estrutura traseira | Estrutura traseira | comum / Traseiro | Estrutura traseira > Painel traseiro | D03 |
| `acabamentos_porta_malas` | Estrutura traseira | Interior do porta-malas | comum / Traseiro | Estrutura traseira > Interior do porta-malas > Acabamentos plásticos do porta-malas | D03 |
| `interno_porta_malas` | Estrutura traseira | Interior do porta-malas | comum / Traseiro | Estrutura traseira > Interior do porta-malas > Interno do porta-malas | D03 |
| `moldura_porta_malas` | Estrutura traseira | Interior do porta-malas | comum / Traseiro | Estrutura traseira > Interior do porta-malas > Molduras do porta-malas | D03 |
| `vidro_traseiro` | Estrutura traseira | Vidros traseiros | comum / Traseiro | Estrutura traseira > Vidros traseiros > Vidro traseiro | D03 |
| `acabamentos_plasticos_teto` | Topo | Acabamentos do teto | comum / Superior | Topo > Acabamentos do teto > Acabamentos plásticos do teto | Aprovar proposta |
| `adesivos_teto` | Topo | Acabamentos do teto | comum / Superior | Topo > Acabamentos do teto > Adesivos do teto | Aprovar proposta |
| `antena` | Topo | Acessórios do teto | comum / Superior | Topo > Acessórios do teto > Antena | Aprovar proposta |
| `bagageiro` | Topo | Acessórios do teto | comum / Superior | Topo > Acessórios do teto > Bagageiro | Aprovar proposta |
| `rack_teto__motorista` | Topo | Acessórios do teto | motorista / Superior | Topo > Acessórios do teto > Rack de teto > Motorista | Aprovar proposta |
| `rack_teto__passageiro` | Topo | Acessórios do teto | passageiro / Superior | Topo > Acessórios do teto > Rack de teto > Passageiro | Aprovar proposta |
| `teto_chapa` | Topo | Teto | comum / Superior | Topo > Teto | Aprovar proposta |
| `teto_panoramico` | Topo | Vidros e aberturas | comum / Superior | Topo > Vidros e aberturas > Teto panorâmico | Aprovar proposta |
| `teto_solar` | Topo | Vidros e aberturas | comum / Superior | Topo > Vidros e aberturas > Teto solar | Aprovar proposta |
| `vidro_teto` | Topo | Vidros e aberturas | comum / Superior | Topo > Vidros e aberturas > Vidro do teto (não especificado) | Aprovar proposta |
| `vidro_teto_solar` | Topo | Vidros e aberturas | comum / Superior | Topo > Vidros e aberturas > Vidro do teto solar | Aprovar proposta |
| `vidro_panoramico` | Topo | Vidros e aberturas | comum / Superior | Topo > Vidros e aberturas > Vidro panorâmico | Aprovar proposta |

## Leitura das ressalvas

25 linhas têm decisão específica D01–D04. D05 é uma ressalva transversal de legibilidade do primeiro nível lateral (13 opções), sem alteração de catálogo. Todos os caminhos são propostas; nenhum foi aplicado. As 163 linhas incluem também os códigos ambíguos, com um único caminho provisório explicitamente marcado. Não há equivalência automática de coluna genérica ou caixa de roda sem eixo.

Os pares Ambos constam no CSV/aba separados e exigem que ambos os códigos estejam ativos e selecionáveis no catálogo real. As referências dos pares não contam como caminhos canônicos adicionais.
