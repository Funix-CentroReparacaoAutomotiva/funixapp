import{useEffect,useRef}from'react'
import type{ButtonHTMLAttributes}from'react'

// A pointer release can land on the dialog/backdrop after feedback moves the button,
// or after routing unmounts it. Consume only that pointer's residual click; a fresh
// pointerdown/keyboard action remains independent. Guards are short-lived and self-cleaning.
function suppressPointerClick(id:number){
 let timer:ReturnType<typeof setTimeout>
 const clean=()=>{clearTimeout(timer);document.removeEventListener('click',click,true);document.removeEventListener('pointerdown',clean,true);document.removeEventListener('pointercancel',clean,true);document.removeEventListener('pointerup',up,true)}
 const click=(event:MouseEvent)=>{if(event.detail>0&&('pointerId'in event?event.pointerId===id:true)){event.preventDefault();event.stopImmediatePropagation();clean()}}
 const up=(event:PointerEvent)=>{if(event.pointerId===id){clearTimeout(timer);timer=setTimeout(clean,100)}}
 document.addEventListener('click',click,true);document.addEventListener('pointerdown',clean,true);document.addEventListener('pointercancel',clean,true);document.addEventListener('pointerup',up,true);timer=setTimeout(clean,4000)
}

// Long press is an alternative to Shift+Enter/right click, never a second click.
// Keep pan-y/native scrolling: dragging, cancellation or interruption consumes the tap.
export function MapPieceButton({onActivate,onOpen,onClick,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{onActivate?:()=>void;onOpen?:()=>void}){
 const press=useRef<{id:number;x:number;y:number;timer:ReturnType<typeof setTimeout>}|null>(null),consumed=useRef(false)
 function cancel(consume=false){if(press.current){const pressId=press.current.id;clearTimeout(press.current.timer);press.current=null;if(consume){consumed.current=true;suppressPointerClick(pressId)}}}
 useEffect(()=>{const interrupt=()=>cancel(true);window.addEventListener('blur',interrupt);document.addEventListener('visibilitychange',interrupt);window.addEventListener('scroll',interrupt,true);return()=>{cancel();window.removeEventListener('blur',interrupt);document.removeEventListener('visibilitychange',interrupt);window.removeEventListener('scroll',interrupt,true)}},[])
 useEffect(()=>{if(props.disabled)cancel(true)},[props.disabled])
 return <button {...props} aria-keyshortcuts={onOpen?'Shift+Enter':undefined} onPointerDown={e=>{
  cancel();consumed.current=false
  if(!onOpen||e.button!==0||!e.isPrimary||props.disabled)return
  const id=e.pointerId,x=e.clientX,y=e.clientY
  press.current={id,x,y,timer:setTimeout(()=>{press.current=null;consumed.current=true;suppressPointerClick(id);onOpen?.()},550)}
 }} onPointerMove={e=>{const p=press.current;if(p&&(p.id!==e.pointerId||Math.hypot(e.clientX-p.x,e.clientY-p.y)>10))cancel(true)}} onPointerUp={()=>cancel()} onPointerCancel={()=>{cancel();consumed.current=true}} onPointerLeave={()=>cancel(true)} onLostPointerCapture={()=>cancel(true)}
 onClick={e=>{if(consumed.current){e.preventDefault();e.stopPropagation();return}if(onActivate)onActivate();else onClick?.(e)}}
 onContextMenu={e=>{if(!onOpen)return;e.preventDefault();const id=press.current?.id??('pointerId'in e.nativeEvent?Number(e.nativeEvent.pointerId):-1);cancel();if(!consumed.current&&!props.disabled){consumed.current=true;suppressPointerClick(id);onOpen?.()}}}
 onKeyDown={e=>{if(e.key==='Escape')cancel(true);if(onOpen&&e.key==='Enter'&&e.shiftKey&&!props.disabled){e.preventDefault();cancel();consumed.current=true;onOpen?.()}else if(e.key==='Enter'||e.key===' '){consumed.current=false}}}/>
}
