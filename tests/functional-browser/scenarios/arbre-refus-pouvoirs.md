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
    "artifacts/refinement/folder-tree-2026-10-08/dossier.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-2-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-3-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/brief-v1.md"
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-09T17:03:56.816Z",
    "proposalSha256": "df1ca76a50c27ea57379b8f7e6da71a17d712070ebed8561252196b36499fdb5",
    "decisionSha256": "9a18bee7d66175dcbc3f033f93fba2501f2ce10ffb1fe422fef6c6a302d255b3",
    "contentSha256": "d645c54c6770e3f2a27e9b3cece721b99bba53e701e310f7de9f7ceea4f8b8a4",
    "contractSha256": "792e55c8800ddc7337e500e97bcf2c495219fb65817d2006a1a88fbb43ba2b47"
  }
}
```

# Refuser intégralement les opérations sans pouvoirs suffisants

Proposition non approuvée et non exécutée. La valeur technique status=active indique une fiche non retirée ; elle ne vaut pas admission au catalogue.

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

- artifacts/refinement/folder-tree-2026-10-08/dossier.json
- artifacts/refinement/folder-tree-2026-10-08/round-2-answer.json
- artifacts/refinement/folder-tree-2026-10-08/round-3-answer.json

Brief candidat v1 : artifacts/refinement/folder-tree-2026-10-08/brief-v1.md ; non approuvé. Les précisions nouvelles proposées dans le brief restent à valider ; cette fiche candidate ne les transforme pas en décisions.
