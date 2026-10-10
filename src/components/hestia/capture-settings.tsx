"use client";
import { useEffect, useRef, useState } from "react";
import type { ClassificationSettingsDto } from "../../shared/capture-contract";
import { Banner, Button, Switch, Dialog, Icon, PageHeader, Select, TextField } from "./design-system";
import { CaptureError, captureRequest } from "./capture-client";
import "./capture.css";

export function CaptureSettings({onBack,onAccessLost}:{onBack:()=>void;onAccessLost:()=>void}) {
  const [settings,setSettings]=useState<ClassificationSettingsDto|null>(null),[key,setKey]=useState(""),[cap,setCap]=useState("");
  const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[remove,setRemove]=useState(false),[message,setMessage]=useState("");
  const [provider,setProvider]=useState(""),[model,setModel]=useState("");
  const controller=useRef<AbortController|null>(null), running=useRef(false);
  const install=(value:ClassificationSettingsDto)=>{setSettings(value);setProvider(value.provider);setModel(value.model);setCap(String(value.monthlyLimitMicros/1_000_000));setEnabled(value.enabled);};
  useEffect(()=>{
    const ac=new AbortController();controller.current=ac;
    void captureRequest<{settings:ClassificationSettingsDto}>("/classification-settings",ac.signal).then(r=>{if(!ac.signal.aborted)install(r.settings);}).catch(e=>{if(!ac.signal.aborted){if(e instanceof CaptureError&&[401,403].includes(e.status))onAccessLost();else setMessage("Réglage indisponible. Réessayez plus tard.");}});
    return()=>{ac.abort();controller.current=null;};
  },[onAccessLost]);
  async function run(action:"save"|"check"|"remove") {
    if(!settings||running.current||!controller.current)return;
    const signal=controller.current.signal;
    const amount=Number(cap.replace(",","."));
    if(action==="save"&&(!Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(Math.round(amount*1_000_000)))){setMessage("Indiquez un plafond mensuel positif en euros.");return;}
    running.current=true;setBusy(true);setMessage("");
    // Credentials leave only in this write-only request. No readback, logging or browser storage.
    const credential=key;setKey("");
    try {
      if(action==="check"){
        const r=await captureRequest<{status:string}>("/classification-settings/check",signal,"POST",{version:settings.version,idempotencyKey:crypto.randomUUID()});
        if(!signal.aborted)setMessage(r.status==="accepted"?"Clé vérifiée auprès du fournisseur.":r.status==="disabled"?"Fournisseur désactivé. Aucun appel externe n’a été effectué.":"La vérification n’a pas abouti. Le classement manuel reste disponible.");
      }else{
        const r=await captureRequest<{settings:ClassificationSettingsDto}>("/classification-settings",signal,action==="remove"?"DELETE":"PUT",action==="remove"?{version:settings.version}:{version:settings.version,provider,model,monthlyLimitMicros:Math.round(amount*1_000_000),enabled,...(credential?{apiKey:credential}:{})});
        if(!signal.aborted){install(r.settings);setRemove(false);setMessage(action==="remove"?"Clé retirée. Les suggestions sont suspendues.":"Réglage enregistré. Aucun fournisseur n’a été contacté.");}
      }
    }catch(e){if(!signal.aborted){if(e instanceof CaptureError&&[401,403].includes(e.status))onAccessLost();else setMessage(e instanceof CaptureError ? e.message : "Résultat non confirmé. Rechargez le réglage avant de recommencer.");}}
    finally{running.current=false;if(!signal.aborted)setBusy(false);}
  }
  const providers=settings?.availableProviders||[];
  const models=providers.find(p=>p.id===provider)?.models||[];
  return <div className="hc-stack hc-settings"><div><Button compact variant="tertiary" icon="chevron-left" onClick={onBack}>Moi</Button></div><PageHeader title="Suggestions de rangement" summary="Réglage commun du foyer"/><Banner title={settings?.enabled&&providers.length?"Service configuré.":"Suggestions suspendues."}>{providers.length?"Chaque personne décide document par document de demander des suggestions.":"Aucun fournisseur compatible n’est actuellement disponible. Le classement manuel reste disponible."}</Banner><div className="hc-note"><Icon name="lock"/><span>Ce réglage ne donne accès à aucun document des membres. Les membres ne voient ni la clé ni ce réglage. Chaque personne décide document par document de demander des suggestions.</span></div>{message&&<Banner title={message}/>} {settings&&<><Select label="Fournisseur" value={provider} disabled={busy||!providers.length} options={[{value:"",label:"Choisir un fournisseur"},...providers.map(p=>({value:p.id,label:p.label})),...(!providers.some(p=>p.id===provider)&&provider?[{value:provider,label:`${provider} (indisponible)`}]:[])]} onChange={value=>{setProvider(value);setModel("");}}/><Select label="Modèle" hint="Seuls les modèles compatibles fournis par l’intégration sont proposés." disabled={busy||!models.length} value={model} options={[{value:"",label:"Choisir un modèle qualifié"},...models.map(m=>({value:m.id,label:m.label})),...(!models.some(m=>m.id===model)&&model?[{value:model,label:`${model} (indisponible)`}]:[])]} onChange={setModel}/><TextField label={settings.keyPresent?"Remplacer la clé API (facultatif)":"Clé API"} type="password" autoComplete="off" spellCheck={false} value={key} placeholder="Collez la clé ici" hint={settings.keyPresent?"Une clé est enregistrée côté serveur ; elle n’est jamais affichée. Laissez vide pour la conserver.":"Conservée côté serveur uniquement, jamais affichée après enregistrement."} onChange={e=>setKey(e.target.value)} disabled={busy}/><TextField label="Plafond mensuel de dépenses (en euros)" inputMode="decimal" value={cap} onChange={e=>setCap(e.target.value)} disabled={busy} hint="Mois civil UTC. Une fois le plafond atteint, les demandes de suggestions sont refusées."/><p className="hc-muted">Période : {new Date(settings.period.start).toLocaleDateString("fr-FR",{timeZone:"UTC"})} au {new Date(settings.period.end).toLocaleDateString("fr-FR",{timeZone:"UTC"})} (UTC). Dépensé : {(settings.spentMicros/1_000_000).toLocaleString("fr-FR")} € · réservé : {(settings.reservedMicros/1_000_000).toLocaleString("fr-FR")} €.</p><Switch label="Suggestions disponibles pour le foyer" description="Désactivez pour suspendre les suggestions sans retirer la clé." checked={enabled} disabled={busy} onChange={setEnabled}/><div className="hc-row"><Button loading={busy} disabled={!provider||!model} onClick={()=>void run("save")}>Enregistrer</Button>{settings.keyPresent&&<Button variant="danger" icon="trash" disabled={busy} onClick={()=>setRemove(true)}>Retirer la clé</Button>}</div><span className="hc-muted">Enregistrer ne contacte pas le fournisseur.</span>{settings.keyPresent&&<section className="hc-stack"><h2 className="hc-section-heading">Vérifier la clé</h2><p className="hc-muted">Contacte le fournisseur lorsqu’il est actif. Cette vérification peut lui être facturée selon ses conditions.</p><div><Button variant="secondary" loading={busy} onClick={()=>void run("check")}>Vérifier auprès du fournisseur</Button></div></section>}</>}{remove&&<Dialog title="Retirer la clé ?" confirmLabel="Retirer la clé" confirmVariant="danger" busy={busy} onConfirm={()=>void run("remove")} onCancel={()=>setRemove(false)}>Les suggestions seront suspendues pour le foyer. Le classement manuel restera disponible.</Dialog>}</div>;
}
