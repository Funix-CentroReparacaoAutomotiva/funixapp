import{useEffect,useRef}from'react'
import type{ReactNode}from'react'
import{ApprovedIcon}from'./ApprovedIcon'

// Only a horizontal intention reveals the action. All deletion uses the caller's queue.
export function DiagnosisSwipeRow({children,name,revealed,onReveal,onRemove,disabled}:{children:ReactNode;name:string;revealed:boolean;onReveal:(open:boolean)=>void;onRemove:()=>void;disabled:boolean}){
 const root=useRef<HTMLDivElement>(null),touch=useRef<{x:number;y:number;time:number;horizontal:boolean}|null>(null),consume=useRef(false)
 useEffect(()=>{
  if(!revealed)return
  const close=(e:Event)=>{if(!(e.target instanceof Element)||!e.target.closest('[data-swipe-delete]'))onReveal(false)}
  const interrupt=()=>{touch.current=null;onReveal(false)}
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();consume.current=false;onReveal(false);root.current?.querySelector<HTMLElement>('.diagnosis-open')?.focus()}}
  document.addEventListener('pointerdown',close,true);document.addEventListener('keydown',key);window.addEventListener('blur',interrupt);document.addEventListener('visibilitychange',interrupt)
  return()=>{document.removeEventListener('pointerdown',close,true);document.removeEventListener('keydown',key);window.removeEventListener('blur',interrupt);document.removeEventListener('visibilitychange',interrupt)}
 },[onReveal,revealed])
 return <div ref={root} className="diagnosis-swipe-shell" data-row-gesture data-revealed={revealed&&!disabled} onTouchStart={e=>{
  touch.current=null;consume.current=false
  if(disabled||e.touches.length!==1||(e.target as Element).closest('button:not(.diagnosis-open),input,textarea,select,a'))return
  const t=e.touches[0];touch.current={x:t.clientX,y:t.clientY,time:e.timeStamp,horizontal:false}
 }} onTouchMove={e=>{
  const p=touch.current;if(!p)return
  if(e.touches.length!==1){touch.current=null;consume.current=true;return}
  const t=e.touches[0],dx=t.clientX-p.x,dy=t.clientY-p.y
  if(!p.horizontal&&Math.abs(dy)>10&&Math.abs(dy)>=Math.abs(dx)/1.8){touch.current=null;return}
  if(Math.abs(dx)>14&&Math.abs(dx)>Math.abs(dy)*1.8){p.horizontal=true;consume.current=true}
 }} onTouchEnd={e=>{
  const p=touch.current;touch.current=null;if(!p||e.changedTouches.length!==1||disabled)return
  const t=e.changedTouches[0],dx=t.clientX-p.x,dy=t.clientY-p.y
  const horizontal=Math.abs(dx)>=60&&Math.abs(dx)>Math.abs(dy)*1.8
  if(horizontal)consume.current=true
  if(horizontal&&e.timeStamp-p.time<=1500)onReveal(dx>0)
 }} onTouchCancel={()=>{touch.current=null;consume.current=true;onReveal(false)}} onClickCapture={e=>{if(consume.current&&(e.target as Element).closest('.diagnosis-open')){consume.current=false;e.preventDefault();e.stopPropagation()}}}
 onKeyDown={e=>{consume.current=false;if(e.key==='Escape'&&revealed){e.preventDefault();onReveal(false);root.current?.querySelector<HTMLElement>('.diagnosis-open')?.focus()}}}>
  <button type="button" data-swipe-delete className="swipe-delete" aria-label={`Excluir peça ${name} de todos os cenários — ação revelada`} tabIndex={revealed&&!disabled?0:-1} aria-hidden={!revealed||disabled} disabled={!revealed||disabled} onClick={()=>{onReveal(false);onRemove()}}><ApprovedIcon name="trash"/><span>Excluir</span></button>
  {children}
 </div>
}
