import type {MouseEventHandler} from 'react'
import './budget-experience.css'

type Props={
 kind:'or'|'os'|'cancel'
 state?:'create'|'view'|'unavailable'
 cancelled?:boolean
 href?:string
 onClick?:()=>void
 disabled?:boolean
 title:string
}
export function DocumentButton({kind,state,cancelled=false,href,onClick,disabled=false,title}:Props){
 const content=<>
  {kind==='cancel'?<svg className="budget-action-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="8.1"/><path d="M8.8 8.8 15.2 15.2M15.2 8.8 8.8 15.2"/></svg>:
  <svg className="budget-action-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
   <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5v4h4"/>
   {kind==='or'?<><path d="M9 11h6M9 14h6M9 17h4"/></>:<>
    {/* Lucide hammer icon reduced to fit within the document silhouette. */}
    <g transform="translate(8.1 9.2) scale(.42)"><path d="m15 12-8.373 8.373a1 1 0 0 1-3.002-3.002L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-7-7a2.121 2.121 0 0 0-3 0l-1.5 1.5 9 9 1.5-1.5a2.121 2.121 0 0 0 0-3Z"/></g>
   </>}
  </svg>}
  {kind!=='cancel'&&<span className="budget-action-text">{kind.toUpperCase()}</span>}
  {kind!=='cancel'&&state!=='unavailable'&&<span className={`budget-action-badge ${state==='create'?'badge-create':'badge-view'}`} aria-hidden="true">
    {state==='create'?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round"><path d="M12 4v16M4 12h16"/></svg>:
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6z"/><circle cx="12" cy="12" r="2.7"/></svg>}
   </span>}
 </>
 const visualState=kind==='cancel'?'':cancelled?' budget-action-cancelled':state==='view'?' budget-action-issued':state==='create'?' budget-action-pending':' budget-action-unavailable'
 const className='budget-action budget-action-'+kind+visualState
 if(href)return <a className={className} href={href} target="_blank" rel="noopener noreferrer" aria-label={title} title={title}>{content}</a>
 const click:MouseEventHandler<HTMLButtonElement>=()=>onClick?.()
 return <button type="button" className={className} onClick={click} disabled={disabled} aria-label={title} title={title}>{content}</button>
}
