"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated, bounded Blob previews must not use the image optimizer. */
import { useEffect, useState } from "react";
import type { CaptureCrop, CapturePageDto } from "../../shared/capture-contract";
import { captureBlob } from "./capture-client";
import { Icon } from "./design-system";

// P17: the server applies EXIF orientation, rotation, then crop in displayed axes.
// We intentionally do not repeat the prototype's CSS clip (which clipped the frame).
export function CapturePageTile({ captureId, page, width = 64 }: {captureId: string; page: CapturePageDto; width?: number}) {
  const [preview, setPreview] = useState<{version:number;url:string}|null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let url: string | null = null;
    void captureBlob(captureId, {pageId:page.id}, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setPreview({version:page.version,url}); setFailed(false);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [captureId, page.id, page.version]);
  return <figure className="hc-tile" style={{width,height:Math.round(width*1.414)}}>{preview?.version===page.version&&!failed ? <img src={preview.url} alt={`Page ${page.order + 1}, ajustements appliqués`} draggable={false} onError={()=>setFailed(true)}/> : <span>{failed ? "Aperçu indisponible" : "Chargement de l’aperçu"}</span>}</figure>;
}
export function CaptureIconButton({icon,label,disabled,onClick}:{icon:string;label:string;disabled?:boolean;onClick:()=>void}) {
  return <button type="button" className="cdv-focus hc-icon-button" aria-label={label} disabled={disabled} onClick={onClick}><Icon name={icon}/></button>;
}
export function CaptureCropStepper({crop,disabled,onChange}:{crop:CaptureCrop;disabled:boolean;onChange:(crop:CaptureCrop)=>void}) {
  const edges = [["t","Haut","en haut"],["b","Bas","en bas"],["l","Gauche","à gauche"],["r","Droite","à droite"]] as const;
  return <fieldset className="hc-crop" disabled={disabled}><legend>Recadrer</legend><div className="hc-crop-grid">{edges.map(([key,label,where])=><div key={key} role="group" aria-label={`Rogner ${where}`} className="hc-edge"><span>{label}<small aria-live="polite">{crop[key] ? `rogné de ${crop[key]} %` : "non rogné"}</small></span><span className="hc-row" style={{gap:4,flexWrap:"nowrap"}}><CaptureIconButton icon="arrow-down" label={`Rogner moins ${where}`} disabled={disabled||crop[key]<=0} onClick={()=>onChange({...crop,[key]:crop[key]-5})}/><CaptureIconButton icon="arrow-up" label={`Rogner davantage ${where}`} disabled={disabled||crop[key]>=40} onClick={()=>onChange({...crop,[key]:crop[key]+5})}/></span></div>)}</div></fieldset>;
}
