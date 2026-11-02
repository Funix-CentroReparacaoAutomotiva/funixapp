import{useEffect,useLayoutEffect,useRef,useState}from'react'
import{PieceSelectionQueue,emptySelectionState}from'./piece-selection-queue'
import type{PieceSelectionTransport}from'./piece-selection-queue'
export function usePieceSelection(at:string,adapter:Omit<PieceSelectionTransport,'changed'>&{failed:(error:unknown)=>void}){
 const current=useRef(adapter)
 useLayoutEffect(()=>{current.current=adapter},[adapter])
 const [state,setState]=useState(emptySelectionState)
 // oxlint-disable-next-line react/refs -- Transport closures read the last committed adapter asynchronously, never during render.
 const [queue]=useState(()=>new PieceSelectionQueue(at,{
  read:id=>current.current.read(id),add:(codes,id,revision)=>current.current.add(codes,id,revision),remove:request=>current.current.remove(request),confirmRemoval:review=>current.current.confirmRemoval(review),
  confirmed:w=>current.current.confirmed(w),changed:next=>{setState(next);if(next.phase==='blocked')current.current.failed(next.error)}
 }))
 useEffect(()=>{queue.resume();return()=>queue.suspend()},[queue])
 return{queue,state}
}
