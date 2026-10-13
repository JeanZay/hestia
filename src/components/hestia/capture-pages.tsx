"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated, bounded Blob previews must not use the image optimizer. */
import { useEffect, useRef, useState } from "react";
import type { CaptureCrop, CapturePageDto, CapturePreviewVariant } from "../../shared/capture-contract";
import { CaptureError } from "./capture-client";
import { capturePreviews } from "./capture-preview-cache";
import { Icon } from "./design-system";

// P17: the server applies EXIF orientation, rotation, then crop in displayed axes.
// We intentionally do not repeat the prototype's CSS clip (which clipped the frame).
export function CapturePageTile({ userId, privacyEpoch, captureId, page, variant = "thumbnail", width = 64, onFailure }: {userId: string; privacyEpoch: number; captureId: string; page: CapturePageDto; variant?: CapturePreviewVariant; width?: number; onFailure: (error: unknown) => void}) {
  const [preview, setPreview] = useState<{key:string;url:string}|null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const image = useRef<HTMLImageElement>(null), failure = useRef(onFailure);
  useEffect(() => { failure.current = onFailure; }, [onFailure]);
  const key = JSON.stringify([userId, privacyEpoch, captureId, page.id, page.version, variant]);
  useEffect(() => {
    let disposed = false;
    if (!capturePreviews.admitted({userId, epoch: privacyEpoch})) return;
    const lease = capturePreviews.acquire({userId, epoch: privacyEpoch, captureId, pageId: page.id, pageVersion: page.version, variant}, reason => {
      // Remove the DOM source synchronously too: React can defer its repaint.
      image.current?.removeAttribute("src");
      if (!disposed) {
        setPreview(null);
        if (reason === "expired" && !document.hidden && capturePreviews.admitted({userId, epoch: privacyEpoch})) setRetry(value => value + 1);
      }
    });
    void lease.ready.then(url => {
      if (!disposed && lease.current()) { setPreview({key, url}); setFailed(false); }
    }).catch(error => {
      if (disposed || error instanceof DOMException && error.name === "AbortError") return;
      setFailed(true);
      if (error instanceof CaptureError && [401, 403, 404, 409, 410].includes(error.status)) failure.current(error);
    });
    return () => { disposed = true; lease.release(); };
  }, [userId, privacyEpoch, captureId, page.id, page.version, variant, key, retry]);
  return <figure className="hc-tile" style={{width,height:Math.round(width*1.414)}}>{preview?.key===key&&!failed ? <img ref={image} src={preview.url} alt={`Page ${page.order + 1}, ajustements appliqués`} draggable={false} onError={()=>setFailed(true)}/> : <span>{failed ? "Aperçu indisponible" : "Chargement de l’aperçu"}</span>}</figure>;
}
export function CaptureIconButton({icon,label,disabled,onClick}:{icon:string;label:string;disabled?:boolean;onClick:()=>void}) {
  return <button type="button" className="cdv-focus hc-icon-button" aria-label={label} disabled={disabled} onClick={onClick}><Icon name={icon}/></button>;
}
export function CaptureCropStepper({crop,disabled,onChange}:{crop:CaptureCrop;disabled:boolean;onChange:(crop:CaptureCrop)=>void}) {
  const edges = [["t","Haut","en haut"],["b","Bas","en bas"],["l","Gauche","à gauche"],["r","Droite","à droite"]] as const;
  return <fieldset className="hc-crop" disabled={disabled}><legend>Recadrer</legend><div className="hc-crop-grid">{edges.map(([key,label,where])=><div key={key} role="group" aria-label={`Rogner ${where}`} className="hc-edge"><span>{label}<small aria-live="polite">{crop[key] ? `rogné de ${crop[key]} %` : "non rogné"}</small></span><span className="hc-row" style={{gap:4,flexWrap:"nowrap"}}><CaptureIconButton icon="arrow-down" label={`Rogner moins ${where}`} disabled={disabled||crop[key]<=0} onClick={()=>onChange({...crop,[key]:crop[key]-5})}/><CaptureIconButton icon="arrow-up" label={`Rogner davantage ${where}`} disabled={disabled||crop[key]>=40} onClick={()=>onChange({...crop,[key]:crop[key]+5})}/></span></div>)}</div></fieldset>;
}
