"use client";

import {useId, useState} from "react";
import {Icon} from "./design-system";

export type MoveImpactGroup = {icon: string; title: string; lead?: string; items: {name: string; text: string; details?: {text: string; folders: string[]}[]}[]};

function OpenButton({label,onClick}:{label:string;onClick:()=>void}) {
  const [hover,setHover]=useState(false);
  return <button type="button" className="cdv-focus" aria-label={label} title={label} onClick={onClick} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} style={{width:44,height:44,display:"inline-flex",alignItems:"center",justifyContent:"center",borderRadius:"var(--cdv-radius-m)",cursor:"pointer",background:hover?"var(--cdv-action-tint)":"transparent",border:"1.5px solid transparent",color:hover?"var(--cdv-action-hover)":"var(--cdv-ink)",transition:"background var(--cdv-duration) var(--cdv-ease)"}}><Icon name="chevron-right" size={20}/></button>;
}

// Faithful TypeScript ports of validated Clé de voûte 1.3/1.3.1:
// ds-ext/propositions-1.3.js PickRow, ImpactItem and AccessImpact.
export function PickRow({label, meta, selected = false, disabled = false, reason, onPick, onOpen, icon = "folder", last = false}: {label: string; meta?: string; selected?: boolean; disabled?: boolean; reason?: string; onPick: () => void; onOpen?: () => void; icon?: string; last?: boolean}) {
  const [hover, setHover] = useState(false);
  const pick = () => { if (!disabled) onPick(); };
  return <div style={{display:"flex",alignItems:"stretch",borderBottom:last?0:"1.5px solid var(--cdv-border-subtle)",background:selected?"var(--cdv-surface-selected)":hover&&!disabled?"var(--cdv-bg)":"transparent",boxShadow:selected?"inset 3px 0 0 var(--cdv-action)":"none"}}>
    <div role="radio" aria-label={label} aria-checked={selected} aria-disabled={disabled||undefined} tabIndex={0} className="cdv-focus" onClick={pick} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onKeyDown={event=>{if(event.key===" "||event.key==="Enter"){event.preventDefault();pick();}}} style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:12,minHeight:"var(--cdv-row-h)",padding:"8px 12px 8px 16px",cursor:disabled?"default":"pointer",fontFamily:"var(--cdv-font-text)",color:disabled?"var(--cdv-ink-3)":"var(--cdv-ink)"}}>
      <span aria-hidden="true" style={{flex:"none",width:22,height:22,borderRadius:11,border:disabled?"1.5px dashed var(--cdv-border-strong)":"2px solid "+(selected?"var(--cdv-action)":"var(--cdv-border-strong)"),display:"inline-flex",alignItems:"center",justifyContent:"center",boxSizing:"border-box"}}>{selected&&<span style={{width:10,height:10,borderRadius:5,background:"var(--cdv-action)"}}/>}</span><Icon name={icon} size={20}/><span style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:2}}><span style={{fontWeight:700,fontSize:16,lineHeight:1.3,overflowWrap:"anywhere"}}>{label}</span>{reason?<span style={{display:"flex",alignItems:"center",gap:6,fontSize:14,color:"var(--cdv-ink-3)"}}><Icon name="lock" size={14}/>{reason}</span>:meta&&<span style={{fontSize:14,color:"var(--cdv-ink-3)",overflowWrap:"anywhere"}}>{meta}</span>}</span>
    </div>{onOpen&&<div style={{display:"flex",alignItems:"center",paddingRight:6}}><OpenButton label={`Ouvrir « ${label} »`} onClick={onOpen}/></div>}
  </div>;
}

function ImpactItem({item}: {item: MoveImpactGroup["items"][number]}) {
  const [open,setOpen]=useState(false), [all,setAll]=useState(false); const id=useId();
  const details=item.details??[], count=details.reduce((sum,detail)=>sum+detail.folders.length,0);
  return <li style={{display:"flex",flexDirection:"column",gap:6,fontSize:15,lineHeight:1.45,color:"var(--cdv-ink-2)"}}><span><strong style={{color:"var(--cdv-ink)"}}>{item.name}</strong> — {item.text}</span>{details.length>0&&<button type="button" className="cdv-focus" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)} style={{alignSelf:"flex-start",display:"inline-flex",alignItems:"center",gap:6,minHeight:40,padding:"0 10px",border:"1.5px solid var(--cdv-border)",borderRadius:"var(--cdv-radius-m)",background:"var(--cdv-surface)",cursor:"pointer",fontFamily:"var(--cdv-font-text)",fontSize:14,fontWeight:700,color:"var(--cdv-action)"}}><Icon name={open?"chevron-down":"chevron-right"} size={16}/>{open?"Masquer":"Voir"} les effets différents · {count} {count>1?"éléments":"élément"}</button>}{details.length>0&&open&&<div id={id} role="region" aria-label={`Effets différents pour ${item.name}`} style={{display:"flex",flexDirection:"column",gap:10,padding:"10px 12px",background:"var(--cdv-bg)",borderRadius:"var(--cdv-radius-m)"}}>{details.map((detail,index)=><div key={index} style={{display:"flex",flexDirection:"column",gap:4}}><span style={{fontWeight:700,color:"var(--cdv-ink)"}}>{detail.text}</span><ul style={{margin:0,paddingLeft:18,display:"flex",flexDirection:"column",gap:2}}>{(all?detail.folders:detail.folders.slice(0,6)).map((folder,i)=><li key={i} style={{overflowWrap:"anywhere"}}>{folder}</li>)}</ul>{detail.folders.length>6&&!all&&<button type="button" className="cdv-focus" onClick={()=>setAll(true)} style={{alignSelf:"flex-start",minHeight:36,padding:"0 6px",border:0,background:"transparent",cursor:"pointer",fontFamily:"var(--cdv-font-text)",fontSize:14,color:"var(--cdv-ink-2)",textDecoration:"underline"}}>Afficher les {detail.folders.length-6} autres</button>}</div>)}</div>}</li>;
}

export function AccessImpact({groups,note}: {groups: MoveImpactGroup[]; note?: string}) {
  const shown=groups.filter(group=>group.items.length);
  const box={display:"flex",flexDirection:"column",gap:8,padding:"12px 14px",border:"1.5px solid var(--cdv-border)",borderRadius:"var(--cdv-radius-l)",background:"var(--cdv-surface)",fontFamily:"var(--cdv-font-text)"} as const;
  return <div style={{display:"flex",flexDirection:"column",gap:10}}>{shown.length?shown.map((group,index)=><section key={index} aria-label={group.title} style={box}><h3 style={{margin:0,display:"flex",alignItems:"center",gap:8,fontSize:16,fontWeight:700,color:"var(--cdv-ink)"}}><Icon name={group.icon} size={18}/>{group.title} · {group.items.length}</h3>{group.lead&&<p style={{margin:0,fontSize:14,lineHeight:1.45,color:"var(--cdv-ink-3)"}}>{group.lead}</p>}<ul style={{margin:0,padding:0,listStyle:"none",display:"flex",flexDirection:"column",gap:10}}>{group.items.map((item,i)=><ImpactItem key={i} item={item}/>)}</ul></section>):<div style={box}><span style={{display:"flex",alignItems:"center",gap:8,fontWeight:700,fontSize:16}}><Icon name="check" size={18}/>Aucun changement d’accès : les mêmes personnes gardent les mêmes droits.</span></div>}{note&&<p style={{margin:0,fontSize:14,lineHeight:1.45,color:"var(--cdv-ink-3)"}}>{note}</p>}</div>;
}
