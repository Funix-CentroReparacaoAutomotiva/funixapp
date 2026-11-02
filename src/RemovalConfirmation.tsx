import{useEffect,useRef}from'react'
import type{RemovalReview}from'../shared/piece-removal'
import './removal-confirmation.css'
export function RemovalConfirmation({review,onAnswer}:{review:RemovalReview;onAnswer:(answer:boolean)=>void}){
 const ref=useRef<HTMLDialogElement>(null)
 useEffect(()=>{const opener=document.activeElement as HTMLElement|null,d=ref.current!;d.showModal();d.querySelector<HTMLButtonElement>('button')?.focus();return()=>{d.close();opener?.focus()}},[])
 const plural=review.codes.length>1,subject=plural?'Peças':'Peça',content=review.hasContent?' e conteúdo':''
 return <dialog ref={ref} className="removal-confirmation" aria-label="Confirmar remoção da composição" onCancel={e=>{e.preventDefault();onAnswer(false)}}><p>{review.positions.length?`${subject} ativa${plural?'s':''} nos cenários ${review.positions.join(', ')}. Remover ${plural?'peças':'peça'}${content} de todos os cenários?`:`Remover ${plural?'peças':'peça'}${content} de todos os cenários?`}</p><div><button onClick={()=>onAnswer(false)}>Cancelar</button><button onClick={()=>onAnswer(true)}>Prosseguir</button></div></dialog>
}
