import {useState} from 'react'
import {paymentMethods, type FinancialSettlement, type PaymentMethod} from '../shared/finance'

export function PaymentMethodFields({disabled}: {disabled?: boolean}) {
  const [method,setMethod]=useState('')
  return <>
    <label>Forma de pagamento
      <select name="paymentMethod" value={method} onChange={event=>setMethod(event.target.value)} disabled={disabled} required>
        <option value="">Selecione</option>
        {Object.entries(paymentMethods).map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {method==='credit'&&<label>Parcelas
      <select name="installments" defaultValue="1" disabled={disabled} required>
        {Array.from({length:12},(_,index)=>index+1).map(value=><option key={value} value={value}>{value}x</option>)}
      </select>
    </label>}
  </>
}

export function readPaymentMethod(form: FormData) {
  const paymentMethod=String(form.get('paymentMethod')??'') as PaymentMethod
  return {paymentMethod,...(paymentMethod==='credit'?{installments:Number(form.get('installments'))}:{})}
}

export function paymentMethodLabel({paymentMethod,installments}: FinancialSettlement) {
  if(!paymentMethod)return 'Forma não informada'
  return paymentMethods[paymentMethod]+(installments?' · '+installments+'x':'')
}
