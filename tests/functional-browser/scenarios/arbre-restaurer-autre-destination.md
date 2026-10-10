```json
{
  "schemaVersion": 1,
  "revision": 3,
  "status": "active",
  "theme": "Arborescence et récupération",
  "actor": "Membres synthétiques de la campagne Dev, désignés par leurs seuls alias dans chaque fiche",
  "preconditions": [
    "À préparer séparément avant toute campagne : déploiement Dev et commit observés, comptes synthétiques déjà autorisés et sessions privées disponibles, sélection exacte autorisée et cette version admise au catalogue.",
    "À préparer séparément : fixtures exclusives à cette fiche, préfixées par un identifiant de campagne ; noms, droits initiaux et contenu attendus consignés sans secrets. Aucun envoi de courriel ni création de compte n’est autorisé par la fiche.",
    "Design et interface du besoin implémentés et validés depuis le hand-off Claude Design. Les verbes ci-dessous décrivent des intentions UI ; ils ne prescrivent ni écran, ni composant, ni libellé inventé.",
    "Préparer un lot supprimé Parent-inaccessible/Lot/Enfant/temoin.pdf dans son délai initial. Préparer séparément la perte d’accès au parent et la révocation de Révoqué, après suppression. La disponibilité autorisée du lot dans la corbeille de Restaurateur doit être établie avant campagne ; sinon bloquer.",
    "Destination est autorisée et libre de conflit ; Interdite n’est pas une destination utilisable par Restaurateur. Préparer Révoqué sans aucun accès indépendant valide, direct ou délégué, à Destination/Lot, et sans droit hérité de Destination qui lui permettrait de consulter Lot. Ce bornage concerne cette fixture ; il n’interdit pas au produit de conserver les accès indépendants légitimes. Consigner les dates/échéances visibles sans les modifier."
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
  "id": "arbre-restaurer-autre-destination",
  "title": "Restaurer vers un autre parent accessible sans rétablir un accès révoqué",
  "rights": [
    "Restaurateur peut restaurer le lot conservé dans sa corbeille et gérer les accès concernés, mais ne peut plus utiliser son ancien parent ; il peut modifier Destination. Révoqué a perdu Voir sur le lot depuis sa suppression et ne dispose d’aucun autre accès valide au lot restauré, direct, délégué ou hérité, notamment via Destination ; Nouveau voit Destination."
  ],
  "syntheticData": [
    "Lot/Enfant/temoin.pdf en corbeille ; Parent-inaccessible, Destination, Interdite ; Restaurateur, Révoqué, Nouveau."
  ],
  "objective": "Préserver le lot en corbeille tant qu’aucune destination valable n’est confirmée, puis le restaurer selon les droits actuels.",
  "actions": [
    "Comme Restaurateur, demander la restauration de Lot. Constater que le parent initial inaccessible ne peut pas être utilisé.",
    "Examiner le choix de destination : Interdite est indisponible ou refusée si sélectionnable. Annuler sans choisir de destination valable, puis recharger la corbeille.",
    "Reprendre la restauration, choisir Destination, lire les changements d’accès et annuler une première fois ; recharger la corbeille et Destination.",
    "Reprendre vers Destination, relire les changements d’accès puis confirmer. Recharger et ouvrir Destination/Lot/Enfant/temoin.pdf.",
    "Comme Nouveau puis Révoqué, vérifier par les parcours UI disponibles l’accès au lot restauré."
  ],
  "assertions": [
    "Sans destination valable confirmée, Lot reste en corbeille dans son état initial ; aucune restauration partielle et aucune modification de son échéance visible.",
    "Les changements d’accès de Destination sont annoncés avant confirmation ; annuler conserve le lot en corbeille et Destination inchangée.",
    "Après confirmation, le sous-arbre complet est retrouvé uniquement dans Destination ; Nouveau peut ouvrir le témoin.",
    "Révoqué ne peut ouvrir ni Lot ni temoin.pdf après restauration dans cette fixture sans autre accès valide. Aucun contenu ni chemin privé du parent devenu inaccessible n’est dévoilé pour permettre le choix alternatif."
  ],
  "persistentEffects": [
    "Lot et son sous-arbre restaurés dans Destination selon les accès actuels ; révocation antérieure conservée."
  ],
  "references": [
    "docs/adr/0006-folder-tree-base.md",
    "docs/adr/0007-folder-move.md",
    "docs/adr/0008-folder-trash.md"
  ],
  "approval": {
    "kind": "editorial",
    "actor": "recipe_completion_review",
    "approvedAt": "2026-10-10T09:42:43.581Z",
    "proposalSha256": "44ab2af51c8527ecca580f257f88c76951ee7603851b3f08384aba71fbe945c9",
    "decisionSha256": "ae24971b76464188142c7dfd69cd4536dbe980ff6709589efda82d82b28d120c",
    "contentSha256": "9331a22da9217a2de84d51111119c6feceeff4a299f6c7134c367e606540461b",
    "contractSha256": "e2264fde46d2ce1f5a3ecc67d48f773548fd63b284826c0cea71b587c984f24a"
  }
}
```

# Restaurer vers un autre parent accessible sans rétablir un accès révoqué

L’admission au catalogue est attestée par les métadonnées d’approbation. Elle ne prouve aucune exécution ; chaque nouvelle révision doit être qualifiée sur son déploiement exact.

## Situation et objectif

Préserver le lot en corbeille tant qu’aucune destination valable n’est confirmée, puis le restaurer selon les droits actuels.

Critères : RESTORE, RIGHTS, RECOVERY.

## Acteurs et pouvoirs

- Restaurateur peut restaurer le lot conservé dans sa corbeille et gérer les accès concernés, mais ne peut plus utiliser son ancien parent ; il peut modifier Destination. Révoqué a perdu Voir sur le lot depuis sa suppression et ne dispose d’aucun autre accès valide au lot restauré, direct, délégué ou hérité, notamment via Destination ; Nouveau voit Destination.

## Préparations séparées et données synthétiques

- À préparer séparément avant toute campagne : déploiement Dev et commit observés, comptes synthétiques déjà autorisés et sessions privées disponibles, sélection exacte autorisée et cette version admise au catalogue.
- À préparer séparément : fixtures exclusives à cette fiche, préfixées par un identifiant de campagne ; noms, droits initiaux et contenu attendus consignés sans secrets. Aucun envoi de courriel ni création de compte n’est autorisé par la fiche.
- Design et interface du besoin implémentés et validés depuis le hand-off Claude Design. Les verbes ci-dessous décrivent des intentions UI ; ils ne prescrivent ni écran, ni composant, ni libellé inventé.
- Préparer un lot supprimé Parent-inaccessible/Lot/Enfant/temoin.pdf dans son délai initial. Préparer séparément la perte d’accès au parent et la révocation de Révoqué, après suppression. La disponibilité autorisée du lot dans la corbeille de Restaurateur doit être établie avant campagne ; sinon bloquer.
- Destination est autorisée et libre de conflit ; Interdite n’est pas une destination utilisable par Restaurateur. Préparer Révoqué sans aucun accès indépendant valide, direct ou délégué, à Destination/Lot, et sans droit hérité de Destination qui lui permettrait de consulter Lot. Ce bornage concerne cette fixture ; il n’interdit pas au produit de conserver les accès indépendants légitimes. Consigner les dates/échéances visibles sans les modifier.

- Lot/Enfant/temoin.pdf en corbeille ; Parent-inaccessible, Destination, Interdite ; Restaurateur, Révoqué, Nouveau.

## Actions dans l’interface

1. Comme Restaurateur, demander la restauration de Lot. Constater que le parent initial inaccessible ne peut pas être utilisé.
2. Examiner le choix de destination : Interdite est indisponible ou refusée si sélectionnable. Annuler sans choisir de destination valable, puis recharger la corbeille.
3. Reprendre la restauration, choisir Destination, lire les changements d’accès et annuler une première fois ; recharger la corbeille et Destination.
4. Reprendre vers Destination, relire les changements d’accès puis confirmer. Recharger et ouvrir Destination/Lot/Enfant/temoin.pdf.
5. Comme Nouveau puis Révoqué, vérifier par les parcours UI disponibles l’accès au lot restauré.

## Résultats visibles attendus

- Sans destination valable confirmée, Lot reste en corbeille dans son état initial ; aucune restauration partielle et aucune modification de son échéance visible.
- Les changements d’accès de Destination sont annoncés avant confirmation ; annuler conserve le lot en corbeille et Destination inchangée.
- Après confirmation, le sous-arbre complet est retrouvé uniquement dans Destination ; Nouveau peut ouvrir le témoin.
- Révoqué ne peut ouvrir ni Lot ni temoin.pdf après restauration dans cette fixture sans autre accès valide. Aucun contenu ni chemin privé du parent devenu inaccessible n’est dévoilé pour permettre le choix alternatif.

## Effets persistants et remise en état

- Lot et son sous-arbre restaurés dans Destination selon les accès actuels ; révocation antérieure conservée.

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
