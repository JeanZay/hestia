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
    "Préparer Parent/Lot/Enfant/actif.pdf et Lot/deja-supprime.pdf déjà en corbeille avant cette campagne, encore dans son délai initial. Consigner sa date de suppression et son échéance disponibles dans l’UI ; la preuve serveur de leur non-modification reste un test automatique séparé.",
    "Le futur parcours dure moins que le délai disponible et ne simule ni n’accélère le temps."
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
  "id": "arbre-corbeille-restauration-exacte",
  "title": "Restaurer uniquement la suppression du dossier, sans écraser un homonyme",
  "rights": [
    "Gestionnaire possède Consulter ainsi que les pouvoirs de suppression et de restauration sur toute la fixture et son parent. Il dispose aussi de Modifier et Déposer sur Parent ; le nouveau Lot hérite de Consulter, Modifier et Déposer depuis Parent, permettant sa création et le dépôt de temoin-homonyme.pdf sans gain de pouvoir implicite."
  ],
  "syntheticData": [
    "Lot, Enfant, actif.pdf, deja-supprime.pdf, nouveau Lot/temoin-homonyme.pdf, nom Lot-restaure."
  ],
  "objective": "Mettre un sous-arbre à la corbeille puis restituer exactement ce lot, en laissant une suppression antérieure inchangée et en résolvant un conflit de nom.",
  "actions": [
    "Comme Gestionnaire, ouvrir Lot, vérifier actif.pdf puis supprimer Lot et confirmer l’action selon l’interface.",
    "Recharger et consulter la corbeille : identifier Lot et la suppression antérieure deja-supprime.pdf.",
    "Depuis Parent, créer un nouveau dossier Lot et y déposer le témoin synthétique autorisé temoin-homonyme.pdf.",
    "Dans la corbeille, demander la restauration du premier Lot ; constater le conflit et fournir Lot-restaure.",
    "Recharger Parent, ouvrir Lot-restaure/Enfant/actif.pdf et Lot/temoin-homonyme.pdf, puis consulter à nouveau la corbeille."
  ],
  "assertions": [
    "Après suppression, le premier Lot et ses éléments actifs quittent la navigation active et sont restaurables depuis la corbeille pendant leur délai de sept jours.",
    "Le conflit de restauration exige un autre nom sans fusion ni écrasement du nouveau Lot.",
    "Lot-restaure restitue Enfant et actif.pdf ; le nouveau Lot et son témoin restent intacts.",
    "deja-supprime.pdf reste en corbeille et ne réapparaît pas dans Lot-restaure. Les dates/échéances exposées dans l’UI restent celles initialement observées ; aucune prolongation attendue.",
    "La restauration n’inclut aucun élément étranger à la suppression du dossier."
  ],
  "persistentEffects": [
    "Sous-arbre restauré sous Lot-restaure ; dossier homonyme témoin conservé ; document précédemment supprimé reste à la corbeille selon son échéance initiale."
  ],
  "references": [
    "docs/adr/0006-folder-tree-base.md",
    "docs/adr/0008-folder-trash.md"
  ],
  "approval": {
    "kind": "editorial",
    "actor": "recipe_completion_review",
    "approvedAt": "2026-10-10T09:42:40.227Z",
    "proposalSha256": "d285c139219186eb5f2807ada90a997fdc061f1e2b4eb7bcdb3da9d0d739beb7",
    "decisionSha256": "14b425a013c59ca5053b259b9e4e119f33f84d87ff913c1f7360cac178c98496",
    "contentSha256": "c8c3555000094998dd143cd54c15271d3cfd81be4805222590b1b862384465f5",
    "contractSha256": "65f7c31202643ab4d482b3da91a1888ea24dd18582eedce1925dbf3db96caad5"
  }
}
```

# Restaurer uniquement la suppression du dossier, sans écraser un homonyme

L’admission au catalogue est attestée par les métadonnées d’approbation. Elle ne prouve aucune exécution ; chaque nouvelle révision doit être qualifiée sur son déploiement exact.

## Situation et objectif

Mettre un sous-arbre à la corbeille puis restituer exactement ce lot, en laissant une suppression antérieure inchangée et en résolvant un conflit de nom.

Critères : TRASH, RESTORE, NAMES.

## Acteurs et pouvoirs

- Gestionnaire possède Consulter ainsi que les pouvoirs de suppression et de restauration sur toute la fixture et son parent. Il dispose aussi de Modifier et Déposer sur Parent ; le nouveau Lot hérite de Consulter, Modifier et Déposer depuis Parent, permettant sa création et le dépôt de temoin-homonyme.pdf sans gain de pouvoir implicite.

## Préparations séparées et données synthétiques

- À préparer séparément avant toute campagne : déploiement Dev et commit observés, comptes synthétiques déjà autorisés et sessions privées disponibles, sélection exacte autorisée et cette version admise au catalogue.
- À préparer séparément : fixtures exclusives à cette fiche, préfixées par un identifiant de campagne ; noms, droits initiaux et contenu attendus consignés sans secrets. Aucun envoi de courriel ni création de compte n’est autorisé par la fiche.
- Design et interface du besoin implémentés et validés depuis le hand-off Claude Design. Les verbes ci-dessous décrivent des intentions UI ; ils ne prescrivent ni écran, ni composant, ni libellé inventé.
- Préparer Parent/Lot/Enfant/actif.pdf et Lot/deja-supprime.pdf déjà en corbeille avant cette campagne, encore dans son délai initial. Consigner sa date de suppression et son échéance disponibles dans l’UI ; la preuve serveur de leur non-modification reste un test automatique séparé.
- Le futur parcours dure moins que le délai disponible et ne simule ni n’accélère le temps.

- Lot, Enfant, actif.pdf, deja-supprime.pdf, nouveau Lot/temoin-homonyme.pdf, nom Lot-restaure.

## Actions dans l’interface

1. Comme Gestionnaire, ouvrir Lot, vérifier actif.pdf puis supprimer Lot et confirmer l’action selon l’interface.
2. Recharger et consulter la corbeille : identifier Lot et la suppression antérieure deja-supprime.pdf.
3. Depuis Parent, créer un nouveau dossier Lot et y déposer le témoin synthétique autorisé temoin-homonyme.pdf.
4. Dans la corbeille, demander la restauration du premier Lot ; constater le conflit et fournir Lot-restaure.
5. Recharger Parent, ouvrir Lot-restaure/Enfant/actif.pdf et Lot/temoin-homonyme.pdf, puis consulter à nouveau la corbeille.

## Résultats visibles attendus

- Après suppression, le premier Lot et ses éléments actifs quittent la navigation active et sont restaurables depuis la corbeille pendant leur délai de sept jours.
- Le conflit de restauration exige un autre nom sans fusion ni écrasement du nouveau Lot.
- Lot-restaure restitue Enfant et actif.pdf ; le nouveau Lot et son témoin restent intacts.
- deja-supprime.pdf reste en corbeille et ne réapparaît pas dans Lot-restaure. Les dates/échéances exposées dans l’UI restent celles initialement observées ; aucune prolongation attendue.
- La restauration n’inclut aucun élément étranger à la suppression du dossier.

## Effets persistants et remise en état

- Sous-arbre restauré sous Lot-restaure ; dossier homonyme témoin conservé ; document précédemment supprimé reste à la corbeille selon son échéance initiale.

- Conserver les seules fixtures de cette fiche avec leurs identifiants et leur état final dans le rapport. Une suppression ou réinitialisation ultérieure exige une préparation bornée et autorisée ; aucun reset global et aucune purge irréversible pendant ce parcours.

## Arrêt et limites

- Prérequis absent, version Dev inconnue, session privée indisponible ou données non synthétiques : bloquer avant les gestes.
- Dérive du déploiement, contamination, session invalide ou mutation incertaine : arrêter et réconcilier ; aucune relance aveugle.
- Résultat visible contraire à une assertion : constater l’échec, sans changer la fiche ni réparer le produit dans cette tentative.

La rétention exacte et les bornes serveur de sept jours sont à contrôler par tests automatiques distincts. Sans attente réelle et observation UI appropriée, cette fiche ne prouve pas l’expiration à sept jours ni une échéance non affichée. Aucun état interne ne remplace une assertion UI. Les fixtures indépendantes n’imposent aucun autre parcours du catalogue.

## Sources

- docs/adr/0006-folder-tree-base.md
- docs/adr/0008-folder-trash.md

Ces références publiques documentent les règles attendues. Les sources détaillées des accords restent privées ; cette correction ne change ni le parcours approuvé ni ses assertions et ne transfère aucun résultat historique.
