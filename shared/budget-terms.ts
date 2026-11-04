export const INSTALLMENT_PLANS = [['tres',3],['seis',6],['nove',9],['doze',12]] as const
export type InstallmentKey = typeof INSTALLMENT_PLANS[number][0]
export interface InstallmentConfiguration {revision:number;updatedAt:string;rates:Record<InstallmentKey,string>}
export interface InstallmentSnapshot {
 revision:number;rates:InstallmentConfiguration['rates'];rounding:'half-up-cent-independent'
 plans:Record<InstallmentKey,{count:number;percent:string;total:string;unit:string;exactTotal:{n:string;d:string};exactUnit:{n:string;d:string};displayDifference:string}>
}
export interface ScenarioDeadline {mode:'automatic'|'manual';manualDays:number|null}
export interface ExecutionDeadline extends ScenarioDeadline {technicalDays:string|null;effectiveDays:number|null;warning:string|null}

export type Installment={valorParcela:string;total:string}
export type JsreportTerms={
 prazoDiasUteis:string
 parcelamento:{tres:Installment;seis:Installment;nove:Installment;doze:Installment}
}
export interface JsreportDocument{
 meta:{id:string;dataCriacao:string}
 cliente:{nome:string;contato:string}
 veiculo:{modelo:string;placa:string}
 diagnosticos:{nome:string;resumo:string;totalServicos:string;totalComponentes:string;clusters:({tipo:'servico';nome:string;valor:string;descricaoTexto:string[]}|{tipo:'itens';nome:'Itens';valor:string;itensDetalhados:{nome:string;valorUnitario:string;quantidade:string;valorTotal:string}[]})[]}[]
 condicoes:{prazo:string}
 parcelamento:JsreportTerms['parcelamento']
 financeiro:{servicos:string;pecas:string;desconto:string;totalVista:string}
}
