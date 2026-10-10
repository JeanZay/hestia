```json
{
  "schemaVersion": 1,
  "revision": 2,
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
    "docs/adr/0006-folder-tree-base.md",
    "docs/adr/0007-folder-move.md"
  ],
  "approval": {
    "kind": "editorial",
    "actor": "recipe_completion_review",
    "approvedAt": "2026-10-10T09:42:41.975Z",
    "proposalSha256": "63982e7ba48239bead68d7954c893e59c55e533d51239b31dd29edf13c8348d0",
    "decisionSha256": "d6db1063bc58ab652bf2a9eddf1fbf19f2cf860df8393269bd2b13737606d24c",
    "contentSha256": "44bf9ba5ade54cb6f4b189105a0e40c487da89d6b43a07acf3ac2588b41c2bab",
    "contractSha256": "4c98c8d0837068f7f33019c624ae1d39240f80a1c191baca8e2d846aa4b89873"
  }
}
```

# Un document déplacé prend les accès du dossier de destination

L’admission au catalogue est attestée par les métadonnées d’approbation. Elle ne prouve aucune exécution ; chaque nouvelle révision doit être qualifiée sur son déploiement exact.

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

- docs/adr/0006-folder-tree-base.md
- docs/adr/0007-folder-move.md

Ces références publiques documentent les règles attendues. Les sources détaillées des accords restent privées ; cette correction ne change ni le parcours approuvé ni ses assertions et ne transfère aucun résultat historique.
