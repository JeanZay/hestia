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
    "artifacts/refinement/folder-tree-2026-10-08/dossier.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-2-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-3-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/brief-v1.md"
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-09T17:03:57.076Z",
    "proposalSha256": "b74f8e3fd524d343c6e876853e7af4b6b4e4080eedffc0030e746ab0d4644cb7",
    "decisionSha256": "0cfb255cf64943954e8eae36423d314de5777657144d6ccd46a27a0ce252341d",
    "contentSha256": "e1fc2cc768f17266dc3aa5d9a91c0edcbe847933713af7aa82915cb62cd169c7",
    "contractSha256": "5ee058fc3cd0b2cc8379367096d118bfedc1e87e21b958fe423f08736c1e6044"
  }
}
```

# Restaurer vers un autre parent accessible sans rétablir un accès révoqué

Proposition non approuvée et non exécutée. La valeur technique status=active indique une fiche non retirée ; elle ne vaut pas admission au catalogue.

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

- artifacts/refinement/folder-tree-2026-10-08/dossier.json
- artifacts/refinement/folder-tree-2026-10-08/round-2-answer.json
- artifacts/refinement/folder-tree-2026-10-08/round-3-answer.json

Brief candidat v1 : artifacts/refinement/folder-tree-2026-10-08/brief-v1.md ; non approuvé. Les précisions nouvelles proposées dans le brief restent à valider ; cette fiche candidate ne les transforme pas en décisions.
