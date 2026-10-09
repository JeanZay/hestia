```json
{
  "schemaVersion": 1,
  "revision": 1,
  "status": "active",
  "theme": "Arborescence et récupération",
  "actor": "Membres synthétiques de la campagne Dev, désignés par leurs seuls alias dans chaque fiche",
  "preconditions": [
    "À préparer séparément avant toute campagne : déploiement Dev et commit observés, comptes synthétiques déjà autorisés et sessions privées disponibles, sélection exacte autorisée et cette version admise au catalogue.",
    "À préparer séparément : fixtures exclusives à cette fiche, préfixées par un identifiant de campagne ; noms, droits initiaux et contenu attendus consignés sans secrets. Aucun envoi de courriel ni création de compte n’est autorisé par la fiche.",
    "Design et interface du besoin implémentés et validés depuis le hand-off Claude Design. Les verbes ci-dessous décrivent des intentions UI ; ils ne prescrivent ni écran, ni composant, ni libellé inventé.",
    "Préparer Source/document.pdf et Destination vide pour cette fiche, avec les accès exclusifs indiqués."
  ],
  "cleanup": [
    "Conserver les seules fixtures de cette fiche avec leurs identifiants et leur état final dans le rapport. Une suppression ou réinitialisation ultérieure exige une préparation bornée et autorisée ; aucun reset global et aucune purge irréversible pendant ce parcours."
  ],
  "stopConditions": [
    "Prérequis absent, version Dev inconnue, session privée indisponible ou données non synthétiques : bloquer avant les gestes.",
    "Dérive du déploiement, contamination, session invalide ou mutation incertaine : arrêter et réconcilier ; aucune relance aveugle.",
    "Résultat visible contraire à une assertion : constater l’échec, sans changer la fiche ni réparer le produit dans cette tentative."
  ],
  "dependencies": [],
  "id": "arbre-deplacer-document",
  "title": "Un document déplacé prend les accès du dossier de destination",
  "rights": [
    "Gestionnaire peut modifier les deux dossiers et gérer les accès concernés ; Ancien voit seulement Source, Nouveau voit seulement Destination."
  ],
  "syntheticData": [
    "Source/document.pdf et Destination ; aucun document réel."
  ],
  "objective": "Vérifier le changement visible d’emplacement et d’accès d’un document après confirmation explicite.",
  "actions": [
    "Comme Gestionnaire, sélectionner document.pdf dans Source et demander son déplacement vers Destination.",
    "Lire les changements d’accès présentés avant validation, puis confirmer le déplacement.",
    "Recharger et ouvrir le document depuis Destination ; vérifier son absence dans Source.",
    "Comme Nouveau puis Ancien, vérifier par l’interface l’accès au document déplacé."
  ],
  "assertions": [
    "La perte d’accès d’Ancien et le gain d’accès de Nouveau sont annoncés avant confirmation.",
    "Le document est accessible dans Destination et absent de Source ; son nom et son aperçu synthétique restent reconnaissables.",
    "Nouveau peut l’ouvrir ; Ancien ne peut plus y accéder. Aucun droit issu de l’ancien dossier n’est conservé par le seul déplacement."
  ],
  "persistentEffects": [
    "document.pdf déplacé dans Destination avec les droits de cette destination."
  ],
  "references": [
    "artifacts/refinement/folder-tree-2026-10-08/dossier.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-1-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-2-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-3-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/brief-v1.md"
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-09T17:03:54.830Z",
    "proposalSha256": "b119d55e549aed0a01f65425121baa02d6fcfa5290b57321add311d59765fe0a",
    "decisionSha256": "681d4c4b0f35b51e39e72c195f46a0791ecfff6643d0b988081a6fedf77e6a4d",
    "contentSha256": "1925264805df7f51d9f80d337e31d9385d5d77769dd1b26e982332d81615eb42",
    "contractSha256": "08eefb8a148f8e0d2436d6a8c2185a5b575e880440a402d9134f36ad4559d632"
  }
}
```

# Un document déplacé prend les accès du dossier de destination

Proposition non approuvée et non exécutée. La valeur technique status=active indique une fiche non retirée ; elle ne vaut pas admission au catalogue.

## Situation et objectif

Vérifier le changement visible d’emplacement et d’accès d’un document après confirmation explicite.

Critères : MOVE, RIGHTS.

## Acteurs et pouvoirs

- Gestionnaire peut modifier les deux dossiers et gérer les accès concernés ; Ancien voit seulement Source, Nouveau voit seulement Destination.

## Préparations séparées et données synthétiques

- À préparer séparément avant toute campagne : déploiement Dev et commit observés, comptes synthétiques déjà autorisés et sessions privées disponibles, sélection exacte autorisée et cette version admise au catalogue.
- À préparer séparément : fixtures exclusives à cette fiche, préfixées par un identifiant de campagne ; noms, droits initiaux et contenu attendus consignés sans secrets. Aucun envoi de courriel ni création de compte n’est autorisé par la fiche.
- Design et interface du besoin implémentés et validés depuis le hand-off Claude Design. Les verbes ci-dessous décrivent des intentions UI ; ils ne prescrivent ni écran, ni composant, ni libellé inventé.
- Préparer Source/document.pdf et Destination vide pour cette fiche, avec les accès exclusifs indiqués.

- Source/document.pdf et Destination ; aucun document réel.

## Actions dans l’interface

1. Comme Gestionnaire, sélectionner document.pdf dans Source et demander son déplacement vers Destination.
2. Lire les changements d’accès présentés avant validation, puis confirmer le déplacement.
3. Recharger et ouvrir le document depuis Destination ; vérifier son absence dans Source.
4. Comme Nouveau puis Ancien, vérifier par l’interface l’accès au document déplacé.

## Résultats visibles attendus

- La perte d’accès d’Ancien et le gain d’accès de Nouveau sont annoncés avant confirmation.
- Le document est accessible dans Destination et absent de Source ; son nom et son aperçu synthétique restent reconnaissables.
- Nouveau peut l’ouvrir ; Ancien ne peut plus y accéder. Aucun droit issu de l’ancien dossier n’est conservé par le seul déplacement.

## Effets persistants et remise en état

- document.pdf déplacé dans Destination avec les droits de cette destination.

- Conserver les seules fixtures de cette fiche avec leurs identifiants et leur état final dans le rapport. Une suppression ou réinitialisation ultérieure exige une préparation bornée et autorisée ; aucun reset global et aucune purge irréversible pendant ce parcours.

## Arrêt et limites

- Prérequis absent, version Dev inconnue, session privée indisponible ou données non synthétiques : bloquer avant les gestes.
- Dérive du déploiement, contamination, session invalide ou mutation incertaine : arrêter et réconcilier ; aucune relance aveugle.
- Résultat visible contraire à une assertion : constater l’échec, sans changer la fiche ni réparer le produit dans cette tentative.

La rétention exacte et les bornes serveur de sept jours sont à contrôler par tests automatiques distincts. Sans attente réelle et observation UI appropriée, cette fiche ne prouve pas l’expiration à sept jours ni une échéance non affichée. Aucun état interne ne remplace une assertion UI. Les fixtures indépendantes n’imposent aucun autre parcours du catalogue.

## Sources

- artifacts/refinement/folder-tree-2026-10-08/dossier.json
- artifacts/refinement/folder-tree-2026-10-08/round-1-answer.json
- artifacts/refinement/folder-tree-2026-10-08/round-2-answer.json
- artifacts/refinement/folder-tree-2026-10-08/round-3-answer.json

Brief candidat v1 : artifacts/refinement/folder-tree-2026-10-08/brief-v1.md ; non approuvé. Les précisions nouvelles proposées dans le brief restent à valider ; cette fiche candidate ne les transforme pas en décisions.
