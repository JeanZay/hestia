"use client";

import { useMemo, useState } from "react";
import { canSimulateSync, initialConnectors, setConnectorEnabled, simulateSync } from "../domain/connectors";
import type { Connector } from "../domain/connectors";
import { decideProposal, mayUseProposal, searchDocuments } from "../domain/documents";
import type { DocumentCategory, FactProposal, FamilyDocument } from "../domain/documents";
import { extraDocument, initialDocuments } from "../domain/fixtures";
import { Icon } from "./icons";
import type { IconName } from "./icons";

type View = "vault" | "review" | "connectors";
const categories: readonly (DocumentCategory | "Tous")[] = ["Tous", "Logement", "Vie quotidienne", "Administratif"];

export function DemoApp() {
  const [view, setView] = useState<View>("vault");
  const [documents, setDocuments] = useState<readonly FamilyDocument[]>(initialDocuments);
  const [selectedId, setSelectedId] = useState("energy");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DocumentCategory | "Tous">("Tous");
  const [connectors, setConnectors] = useState<readonly Connector[]>(initialConnectors);
  const [circuitOpen, setCircuitOpen] = useState(true);
  const [notice, setNotice] = useState("");

  const filtered = useMemo(() => searchDocuments(documents, query, category), [documents, query, category]);
  const selected = filtered.find((document) => document.id === selectedId) ?? filtered[0];
  const pending = documents.filter((document) => document.proposal?.status === "pending");
  const reviewed = documents.filter((document) => document.proposal && document.proposal.status !== "pending");
  const extraLoaded = documents.some((document) => document.id === extraDocument.id);

  function decide(documentId: string, decision: "accept" | "reject", reviewedSource: boolean) {
    setDocuments((current) => current.map((document) => document.id === documentId && document.proposal
      ? { ...document, proposal: decideProposal(document.proposal, decision, reviewedSource) }
      : document));
    setNotice(decision === "accept"
      ? "Valeur validée pour cette session de démonstration. La source ambiguë est conservée."
      : "Proposition écartée. La valeur ne sera pas utilisée ; l’original reste accessible.");
  }

  function loadExample() {
    if (extraLoaded) return;
    setDocuments((current) => [...current, extraDocument]);
    setSelectedId(extraDocument.id);
    setQuery("");
    setCategory("Tous");
    setView("vault");
    setNotice("L’exemple « Atelier jardin en famille » est chargé dans cette session. Aucun fichier n’a été envoyé.");
  }

  function reset() {
    setDocuments(initialDocuments);
    setConnectors(initialConnectors);
    setCircuitOpen(true);
    setSelectedId("energy");
    setQuery("");
    setCategory("Tous");
    setView("vault");
    setNotice("Démonstration réinitialisée. Le coupe-circuit global est activé.");
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Aller au contenu</a>
      <aside className="sidebar">
        <button className="brand" onClick={reset} aria-label="Hestia, réinitialiser la démonstration">
          <span className="brand-symbol" aria-hidden="true"><Icon name="home" size={25} /></span>
          <span>hestia<span className="brand-dot">.</span></span>
        </button>
        <div className="household"><span className="household-avatar">D</span><div><strong>Foyer Démo</strong><small>Espace synthétique</small></div><span className="small-dot" /></div>
        <p className="nav-caption">VOTRE QUOTIDIEN</p>
        <nav aria-label="Navigation principale">
          <NavButton active={view === "vault"} label="Le coffre" icon="grid" onClick={() => setView("vault")} />
          <NavButton active={view === "review"} label="À valider" icon="check" count={pending.length} onClick={() => setView("review")} />
          <NavButton active={view === "connectors"} label="Connecteurs" icon="plug" onClick={() => setView("connectors")} />
        </nav>
        <div className="sidebar-footer">
          <Icon name="leaf" size={27} />
          <strong>Un foyer, son espace.</strong>
          <p>Un projet ouvert, pensé pour garder la main sur son quotidien.</p>
          <span className="version-label">Fondation locale · v0.1</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">Foyer Démo <span>/</span> <strong>{view === "vault" ? "Le coffre" : view === "review" ? "À valider" : "Connecteurs"}</strong></div>
          <span className="environment-badge"><span className="small-dot" /> Démo locale</span>
        </header>

        <main id="main-content" tabIndex={-1}>
          <div className="demo-banner"><Icon name="shield" size={19} /><p><strong>Un aperçu avec des données 100 % synthétiques.</strong> Aucun compte, fichier personnel ni service externe connecté. Les changements s’effacent au rechargement.</p></div>

          {view === "vault" && <>
            <section className="page-heading">
              <div><p className="eyebrow">MOINS DE PAPIERS ÉPARPILLÉS, PLUS DE CLARTÉ</p><h1>Le quotidien, à sa place.</h1><p>Vos documents, leurs informations et leur source. Simplement.</p></div>
              <button className="button primary" onClick={loadExample} disabled={extraLoaded}><Icon name={extraLoaded ? "check" : "plus"} size={18} />{extraLoaded ? "Exemple ajouté" : "Charger un exemple"}</button>
            </section>

            <div className="overview-grid">
              <div className="overview-card"><span className="stat-icon mint"><Icon name="paper" /></span><div><strong>{documents.length} <span>documents</span></strong><p>Des exemples à explorer</p></div></div>
              <button className="overview-card overview-action" onClick={() => setView("review")}><span className="stat-icon peach"><Icon name="clock" /></span><div><strong>{pending.length} <span>à valider</span></strong><p>{pending.length ? "Une petite vérification suffit" : "Toutes les propositions sont traitées"}</p></div><Icon name="arrow" size={18} /></button>
              <div className="overview-card"><span className="stat-icon lavender"><Icon name="plug" /></span><div><strong>0 <span>service connecté</span></strong><p>Tout reste dans cette démo</p></div></div>
            </div>

            <section className="vault-section" aria-labelledby="vault-title">
              <div className="section-heading"><div><h2 id="vault-title">Votre coffre</h2><p>Retrouver l’essentiel, revenir à l’original.</p></div><span className="quiet-label">ORIGINAUX D’EXEMPLE · TXT</span></div>
              <div className="search-box"><Icon name="search" /><label className="sr-only" htmlFor="document-search">Rechercher un document</label><input id="document-search" type="search" placeholder="Rechercher un document, un mot-clé…" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" spellCheck={false} /><span className="search-hint">Recherche locale</span></div>
              <div className="category-filters" role="group" aria-label="Filtrer par catégorie">{categories.map((item) => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
              <p className="result-count" aria-live="polite">{filtered.length} document{filtered.length > 1 ? "s" : ""}{query ? " trouvé" + (filtered.length > 1 ? "s" : "") : " dans le coffre"}</p>

              <div className="vault-grid">
                <div className="document-list" aria-label="Documents synthétiques">
                  {filtered.map((document) => <button key={document.id} className={`document-card ${document.id === selected?.id ? "selected" : ""}`} onClick={() => setSelectedId(document.id)} aria-pressed={document.id === selected?.id} aria-label={`Voir ${document.title}`}><span className={`document-icon icon-${document.icon}`}><Icon name={document.icon} size={24} /></span><span className="document-card-body"><span className="document-category">{document.category}</span><strong>{document.title}</strong><span className="document-card-meta">{document.dateLabel} <span>·</span> Original TXT</span></span>{document.proposal?.status === "pending" ? <span className="status-badge pending">À vérifier</span> : <Icon name="arrow" size={18} />}</button>)}
                  {filtered.length === 0 && <div className="empty-state"><Icon name="search" size={32} /><h3>Aucun document trouvé</h3><p>Essayez un autre mot-clé ou une autre catégorie.</p><button className="button secondary" onClick={() => { setQuery(""); setCategory("Tous"); }}>Effacer les filtres</button></div>}
                  <div className="catalogue-note"><Icon name="lock" size={15} /><span>Catalogue de démonstration, sans import de fichiers personnels.</span></div>
                </div>
                {selected && <DocumentDetails key={selected.id} document={selected} onReview={() => setView("review")} />}
              </div>
            </section>
          </>}

          {view === "review" && <>
            <section className="page-heading"><div><p className="eyebrow">VOUS GARDEZ LE DERNIER MOT</p><h1>Un doute ? On vérifie.</h1><p>Une proposition incertaine attend votre décision. Sa source reste toujours visible.</p></div><span className="heading-count">{pending.length} en attente</span></section>
            <div className="review-layout">
              <section aria-label="Propositions à valider" className="review-main">
                {pending.map((document) => <ProposalReview key={document.id} document={document} onDecide={(decision, checked) => decide(document.id, decision, checked)} />)}
                {pending.length === 0 && <div className="empty-state review-empty"><span className="stat-icon mint"><Icon name="check" size={28} /></span><h2>Tout est à jour pour cette démo.</h2><p>Il n’y a plus de proposition en attente.</p><button className="button secondary" onClick={() => setView("vault")}>Revenir au coffre <Icon name="arrow" size={17} /></button></div>}
                {reviewed.map((document) => <article className="reviewed-card" key={document.id}><span className={`status-badge ${document.proposal?.status === "accepted" ? "accepted" : "neutral"}`}>{document.proposal?.status === "accepted" ? "Validée dans cette session" : "Proposition écartée"}</span><h3>{document.title}</h3><p>{document.proposal?.label} : <strong>{document.proposal?.value}</strong></p><p>{document.proposal?.status === "accepted" ? "Votre validation explicite autorise l’utilisation de cette valeur dans la démo. L’ambiguïté de la source reste documentée." : "Cette valeur ne peut pas être utilisée. Le refus ne modifie pas l’original."}</p><SourceExcerpt document={document} /></article>)}
              </section>
              <aside className="explainer-card"><span className="eyebrow">UNE IA QUI SAIT S’ARRÊTER</span><h2>Un coup de main.<br />La décision vous revient.</h2><p>Ici, la note mentionne deux dates possibles. Le score d’exemple ne permet pas de savoir laquelle est correcte.</p><ol><li>Lire l’extrait de l’original.</li><li>Confirmer si vous avez pu vérifier la valeur.</li><li>Écarter la proposition si le doute persiste.</li></ol><div className="note-box">Cette proposition est préparée à l’avance. Aucun OCR ni modèle d’IA n’est exécuté dans cette démo.</div></aside>
            </div>
          </>}

          {view === "connectors" && <>
            <section className="page-heading"><div><p className="eyebrow">DES ACCÈS CHOISIS, DES ACTIONS VISIBLES</p><h1>Chaque connexion, sous contrôle.</h1><p>Explorer les commandes des futurs connecteurs. Tous les états ci-dessous sont simulés.</p></div></section>
            <section className={`circuit-card ${circuitOpen ? "paused" : ""}`} aria-labelledby="circuit-title"><span className="stat-icon peach"><Icon name="shield" size={26} /></span><div><h2 id="circuit-title">Coupe-circuit global {circuitOpen ? "activé" : "désactivé"}</h2><p>{circuitOpen ? "Toutes les synchronisations simulées sont bloquées, même si un connecteur est activé." : "Les connecteurs d’exemple autorisés peuvent simuler une synchronisation locale."}</p></div><button className="button secondary" role="switch" aria-checked={circuitOpen} aria-label="Coupe-circuit global" onClick={() => { setCircuitOpen((current) => !current); setNotice(circuitOpen ? "Pause globale levée pour la simulation locale." : "Coupe-circuit activé : toutes les synchronisations simulées sont bloquées."); }}>{circuitOpen ? "Lever la pause simulée" : "Tout mettre en pause"}</button></section>
            <div className="connector-grid">{connectors.map((connector) => <article className="connector-card" key={connector.id} aria-labelledby={`connector-${connector.id}`}><div className="connector-top"><span className={`stat-icon ${connector.id === "files" ? "mint" : connector.id === "mobile" ? "peach" : "lavender"}`}><Icon name={connector.id === "files" ? "paper" : connector.id === "mobile" ? "grid" : "plug"} size={23} /></span><span className={`status-badge ${!connector.enabled || connector.status === "unconfigured" ? "neutral" : connector.status === "error" ? "pending" : circuitOpen ? "neutral" : "accepted"}`}>{!connector.enabled ? "Désactivé" : connector.status === "error" ? "Erreur simulée" : connector.status === "unconfigured" ? "Non configuré" : circuitOpen ? "En pause" : "Prêt à simuler"}</span></div><h2 id={`connector-${connector.id}`}>{connector.name}</h2><p className="connector-description">{connector.description}</p><div className="permissions"><h3>Permissions prévues</h3><ul>{connector.permissions.map((permission) => <li key={permission}><Icon name="check" size={15} />{permission}</li>)}</ul></div><div className="sync-status"><span>Dernière synchronisation</span><strong>{connector.lastSync ?? "Aucune"}</strong></div>{connector.error && <p className="connector-error">{connector.error}</p>}{connector.status === "unconfigured" && <p className="connector-info">Connexion non configurée dans ce lot.</p>}<div className="connector-controls"><label htmlFor={`enable-${connector.id}`}>Connecteur {connector.enabled ? "activé" : "désactivé"}</label><button id={`enable-${connector.id}`} type="button" className={`toggle ${connector.enabled ? "on" : ""}`} role="switch" aria-checked={connector.enabled} aria-label={connector.name} onClick={() => setConnectors((current) => current.map((item) => item.id === connector.id ? setConnectorEnabled(item, !item.enabled) : item))}><span /></button></div><button className="button secondary sync-button" disabled={!canSimulateSync(connector, circuitOpen)} onClick={() => { setConnectors((current) => current.map((item) => item.id === connector.id ? simulateSync(item, circuitOpen) : item)); setNotice(`Simulation terminée pour « ${connector.name} ». Aucun service externe contacté.`); }}>Simuler une synchronisation</button></article>)}</div>
            <div className="connectors-footnote"><Icon name="lock" size={19} /><p><strong>Aucune autorisation réelle n’est demandée.</strong> Les boutons modifient uniquement l’état de cette page ; les permissions, erreurs et dates sont des exemples.</p></div>
          </>}

          <div className="live-notice" role="status" aria-live="polite">{notice && <><Icon name="check" size={18} /><span>{notice}</span></>}</div>
          <footer className="page-footer"><p>Hestia · Votre quotidien, avec vous aux commandes.</p><button onClick={reset}>Réinitialiser la démo</button></footer>
        </main>
      </div>
    </div>
  );
}

function NavButton({ active, label, icon, count, onClick }: { active: boolean; label: string; icon: IconName; count?: number; onClick: () => void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick} aria-label={label}><Icon name={icon} /><span>{label}</span>{count !== undefined && <span className="nav-count" aria-hidden="true">{count}</span>}</button>;
}

function SourceExcerpt({ document }: { document: FamilyDocument }) {
  return <div className="source-excerpt"><div><span><Icon name="paper" size={15} /> Extrait de la source</span><small>Lignes {document.source.lines}</small></div><blockquote>{document.source.excerpt}</blockquote><a href={document.source.originalPath} target="_blank" rel="noopener noreferrer">Ouvrir l’original synthétique <Icon name="external" size={15} /></a></div>;
}

function ProposalStatus({ proposal }: { proposal: FactProposal }) {
  return <div className={`proposal-summary ${proposal.status}`}><span className={`status-badge ${proposal.status === "accepted" ? "accepted" : proposal.status === "pending" ? "pending" : "neutral"}`}>{proposal.status === "pending" ? "Valeur à vérifier" : proposal.status === "accepted" ? "Validée dans cette session" : "Proposition écartée"}</span><strong>{proposal.label}</strong><span>{proposal.value}</span><p>{mayUseProposal(proposal) ? "Valeur autorisée après votre validation explicite." : "Cette valeur n’est pas utilisée."}</p></div>;
}

function DocumentDetails({ document, onReview }: { document: FamilyDocument; onReview: () => void }) {
  return <aside className="detail-panel" aria-labelledby="detail-title"><div className="detail-heading"><span className="eyebrow">LA FICHE DU DOCUMENT</span><span className="status-badge neutral">Synthétique</span></div><h3 id="detail-title">{document.title}</h3><p className="detail-summary">{document.summary}</p><dl className="facts">{document.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>{document.proposal && <><ProposalStatus proposal={document.proposal} />{document.proposal.status === "pending" && <button className="text-button" onClick={onReview}>Vérifier cette proposition <Icon name="arrow" size={16} /></button>}</>}<SourceExcerpt document={document} /><details className="provenance-details"><summary>Provenance et intégrité</summary><dl><div><dt>Origine</dt><dd>Fichier texte synthétique inclus dans le projet</dd></div><div><dt>Fiche</dt><dd>Préparée pour la démonstration, sans OCR ni IA</dd></div><div><dt>Fichier original</dt><dd>{document.source.fileName}</dd></div><div><dt>Empreinte SHA-256 du fichier</dt><dd><code>{document.source.sha256}</code></dd></div></dl><p>Cette empreinte permet de vérifier le fichier d’exemple. Elle ne constitue pas à elle seule un dispositif de conservation immuable.</p></details></aside>;
}

function ProposalReview({ document, onDecide }: { document: FamilyDocument; onDecide: (decision: "accept" | "reject", sourceReviewed: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  if (!document.proposal) return null;
  return <article className="review-card"><div className="review-card-top"><span className="status-badge pending">Vérification nécessaire</span><span className="quiet-label">1 PROPOSITION</span></div><h2>{document.title}</h2><p className="detail-summary">La note contient deux dates possibles. Écartez la proposition si vous ne pouvez pas les départager.</p><div className="proposed-value"><span>{document.proposal.label}</span><strong>{document.proposal.value}</strong><small>Confiance simulée : {Math.round(document.proposal.confidence * 100)} % · insuffisante sans vérification</small></div><SourceExcerpt document={document} /><p className="review-warning"><Icon name="lock" size={17} /> Cette valeur n’est pas utilisée tant que vous ne l’avez pas confirmée.</p><label className="confirmation-check"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span>J’ai vérifié la source et je confirme cette valeur pour l’exercice de démonstration.</span></label><div className="review-actions"><button className="button primary" disabled={!checked} onClick={() => onDecide("accept", checked)}><Icon name="check" size={18} />Confirmer la valeur</button><button className="button secondary" onClick={() => onDecide("reject", false)}>Écarter la proposition</button></div><p className="session-hint">Votre décision reste dans cette session. L’original n’est jamais modifié par ces boutons.</p></article>;
}
