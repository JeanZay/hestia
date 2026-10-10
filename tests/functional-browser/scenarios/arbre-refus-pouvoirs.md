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
    "Préparer trois fixtures indépendantes : Lecture vide ; Source/A/temoin.pdf et Destination avec un changement effectif d’accès ; Parent/Visible/v.pdf et Parent/Protégé/p.pdf, Protégé invisible à Supprimeur. L’état initial est vérifié dans l’UI par Contrôleur."
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
  "id": "arbre-refus-pouvoirs",
  "title": "Refuser intégralement les opérations sans pouvoirs suffisants",
  "rights": [
    "Lecteur a Voir sans Modifier sur Lecture ; Éditeur a Modifier sur Source et Destination mais ne peut pas gérer leur changement d’accès ; Supprimeur peut supprimer Parent mais pas son descendant Protégé ; Contrôleur peut examiner toutes les fixtures."
  ],
  "syntheticData": [
    "Lecture, Source/A, Destination, Parent/Visible, Parent/Protégé et trois témoins synthétiques."
  ],
  "objective": "Vérifier trois refus bornés, sans création de pouvoirs ni suppression partielle ni fuite du descendant protégé.",
  "actions": [
    "Comme Lecteur, tenter de créer un sous-dossier dans Lecture avec les commandes UI disponibles ; constater le refus ou l’indisponibilité de l’action.",
    "Comme Éditeur, tenter de déplacer Source/A vers Destination ; si une confirmation est proposée, tenter de la valider sans acquérir de pouvoirs supplémentaires.",
    "Comme Supprimeur, demander la suppression de Parent et observer le refus sans explorer par un canal technique le descendant protégé.",
    "Comme Contrôleur, recharger chaque fixture et sa corbeille dans l’interface pour rapprocher l’état final de l’état initial."
  ],
  "assertions": [
    "Lecteur ne crée aucun dossier ; l’indisponibilité UI empêche l’action sans élargir ses droits.",
    "Le déplacement non autorisé ne modifie ni Source/A ni Destination ni leurs accès ; confirmer un avertissement ne remplace jamais le pouvoir de gérer les accès.",
    "La suppression de Parent est refusée en entier ; le nom ou contenu du descendant Protégé n’est pas révélé à Supprimeur.",
    "Contrôleur retrouve Parent, Visible/v.pdf et Protégé/p.pdf actifs et inchangés ; aucun de ces éléments n’a été mis à la corbeille."
  ],
  "persistentEffects": [
    "Aucun effet métier attendu dans les trois fixtures. Les contrôles UI complètent des tests serveur séparés des refus et de leur atomicité."
  ],
  "references": [
    "docs/adr/0006-folder-tree-base.md",
    "docs/adr/0007-folder-move.md",
    "docs/adr/0008-folder-trash.md"
  ],
  "approval": {
    "kind": "editorial",
    "actor": "recipe_completion_review",
    "approvedAt": "2026-10-10T09:42:43.263Z",
    "proposalSha256": "f2be3e50559e8f5b22d3bcc8fbce9c186fbe2c6164e3065b098dfd7037c3ea20",
    "decisionSha256": "a14b9a781e4ede2e214a5edafe5047e0d1a0d8d13c72ca10537598afc9f4b1fb",
    "contentSha256": "17901a0b509da3cd84e0f8f0da79a775a12bb116b3b8d9cffe8e5ef7c5d88167",
    "contractSha256": "79f12778788e06ea69158d7cec979944b98902cb575305141f2d32cc9b3759cd"
  }
}
```

# Refuser intégralement les opérations sans pouvoirs suffisants

L’admission au catalogue est attestée par les métadonnées d’approbation. Elle ne prouve aucune exécution ; chaque nouvelle révision doit être qualifiée sur son déploiement exact.

## Situation et objectif

Vérifier trois refus bornés, sans création de pouvoirs ni suppression partielle ni fuite du descendant protégé.

Critères : RIGHTS, MOVE, TRASH.

## Acteurs et pouvoirs

- Lecteur a Voir sans Modifier sur Lecture ; Éditeur a Modifier sur Source et Destination mais ne peut pas gérer leur changement d’accès ; Supprimeur peut supprimer Parent mais pas son descendant Protégé ; Contrôleur peut examiner toutes les fixtures.

## Préparations séparées et données synthétiques

- À préparer séparément avant toute campagne : déploiement Dev et commit observés, comptes synthétiques déjà autorisés et sessions privées disponibles, sélection exacte autorisée et cette version admise au catalogue.
- À préparer séparément : fixtures exclusives à cette fiche, préfixées par un identifiant de campagne ; noms, droits initiaux et contenu attendus consignés sans secrets. Aucun envoi de courriel ni création de compte n’est autorisé par la fiche.
- Design et interface du besoin implémentés et validés depuis le hand-off Claude Design. Les verbes ci-dessous décrivent des intentions UI ; ils ne prescrivent ni écran, ni composant, ni libellé inventé.
- Préparer trois fixtures indépendantes : Lecture vide ; Source/A/temoin.pdf et Destination avec un changement effectif d’accès ; Parent/Visible/v.pdf et Parent/Protégé/p.pdf, Protégé invisible à Supprimeur. L’état initial est vérifié dans l’UI par Contrôleur.

- Lecture, Source/A, Destination, Parent/Visible, Parent/Protégé et trois témoins synthétiques.

## Actions dans l’interface

1. Comme Lecteur, tenter de créer un sous-dossier dans Lecture avec les commandes UI disponibles ; constater le refus ou l’indisponibilité de l’action.
2. Comme Éditeur, tenter de déplacer Source/A vers Destination ; si une confirmation est proposée, tenter de la valider sans acquérir de pouvoirs supplémentaires.
3. Comme Supprimeur, demander la suppression de Parent et observer le refus sans explorer par un canal technique le descendant protégé.
4. Comme Contrôleur, recharger chaque fixture et sa corbeille dans l’interface pour rapprocher l’état final de l’état initial.

## Résultats visibles attendus

- Lecteur ne crée aucun dossier ; l’indisponibilité UI empêche l’action sans élargir ses droits.
- Le déplacement non autorisé ne modifie ni Source/A ni Destination ni leurs accès ; confirmer un avertissement ne remplace jamais le pouvoir de gérer les accès.
- La suppression de Parent est refusée en entier ; le nom ou contenu du descendant Protégé n’est pas révélé à Supprimeur.
- Contrôleur retrouve Parent, Visible/v.pdf et Protégé/p.pdf actifs et inchangés ; aucun de ces éléments n’a été mis à la corbeille.

## Effets persistants et remise en état

- Aucun effet métier attendu dans les trois fixtures. Les contrôles UI complètent des tests serveur séparés des refus et de leur atomicité.

- Conserver les seules fixtures de cette fiche avec leurs identifiants et leur état final dans le rapport. Une suppression ou réinitialisation ultérieure exige une préparation bornée et autorisée ; aucun reset global et aucune purge irréversible pendant ce parcours.

## Arrêt et limites

- Prérequis absent, version Dev inconnue, session privée indisponible ou données non synthétiques : bloquer avant les gestes.
- Dérive du déploiement, contamination, session invalide ou mutation incertaine : arrêter et réconcilier ; aucune relance aveugle.
- Résultat visible contraire à une assertion : constater l’échec, sans changer la fiche ni réparer le produit dans cette tentative.

La rétention exacte et les bornes serveur de sept jours sont à contrôler par tests automatiques distincts. Sans attente réelle et observation UI appropriée, cette fiche ne prouve pas l’expiration à sept jours ni une échéance non affichée. Aucun état interne ne remplace une assertion UI. Les fixtures indépendantes n’imposent aucun autre parcours du catalogue.

## Sources

- docs/adr/0006-folder-tree-base.md
- docs/adr/0007-folder-move.md
- docs/adr/0008-folder-trash.md

Ces références publiques documentent les règles attendues. Les sources détaillées des accords restent privées ; cette correction ne change ni le parcours approuvé ni ses assertions et ne transfère aucun résultat historique.
