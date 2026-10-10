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
    "Préparer Parent/Enfant/temoin.pdf et les trois membres synthétiques. Aucun accès explicite préalable sur Enfant."
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
  "id": "arbre-heritage-exception",
  "title": "Une exception ciblée laisse les autres droits hériter",
  "rights": [
    "Gestionnaire peut gérer les accès de Parent et Enfant ; Alex et Sam ont initialement Voir hérité de Parent."
  ],
  "syntheticData": [
    "Parent/Enfant/temoin.pdf ; Gestionnaire, Alex, Sam."
  ],
  "objective": "Restreindre Alex dans un sous-dossier sans figer les droits des autres personnes ni modifier son accès au parent.",
  "actions": [
    "Comme Gestionnaire, retirer Voir à Alex uniquement sur Enfant au moyen de l’exception prévue par l’interface.",
    "Comme Alex, ouvrir Parent puis essayer d’accéder à Enfant ; comme Sam, ouvrir Enfant et son témoin.",
    "Comme Gestionnaire, retirer ensuite Voir à Sam sur Parent ; comme Sam, recharger et essayer d’ouvrir Enfant.",
    "Comme Gestionnaire, rétablir Voir à Sam sur Parent ; comme Sam puis Alex, vérifier à nouveau l’accès à Enfant."
  ],
  "assertions": [
    "Alex conserve son accès à Parent mais ne voit pas le contenu d’Enfant après l’exception.",
    "Sam accède initialement au témoin ; sa révocation sur Parent retire aussi cet accès à Enfant.",
    "Le rétablissement sur Parent rend Enfant accessible à Sam ; l’exception d’Alex reste active.",
    "La restriction ciblée n’ajoute aucun pouvoir et ne remplace pas les droits hérités de toutes les personnes par une copie figée."
  ],
  "persistentEffects": [
    "Exception de restriction d’Alex sur Enfant conservée ; droit de Sam sur Parent revenu à son état initial par les gestes UI."
  ],
  "references": [
    "docs/adr/0006-folder-tree-base.md"
  ],
  "approval": {
    "kind": "editorial",
    "actor": "recipe_completion_review",
    "approvedAt": "2026-10-10T09:42:42.609Z",
    "proposalSha256": "24948548c397ba90ce96f575a501c4e95aa135e525dfbf8bf3f8b1673a5978d7",
    "decisionSha256": "9be74dc0b7b01229c89484fbb49659d669386c06bf53596fe5be98f88e7e4179",
    "contentSha256": "5dfda9554953a3f2726343791ccd00c4e79879a71d65e7931f394adbd9f8546c",
    "contractSha256": "b2bd44aad20af3866462c4d7a5fa4145d249efdd425929a004baac95745a0c20"
  }
}
```

# Une exception ciblée laisse les autres droits hériter

L’admission au catalogue est attestée par les métadonnées d’approbation. Elle ne prouve aucune exécution ; chaque nouvelle révision doit être qualifiée sur son déploiement exact.

## Situation et objectif

Restreindre Alex dans un sous-dossier sans figer les droits des autres personnes ni modifier son accès au parent.

Critères : RIGHTS.

## Acteurs et pouvoirs

- Gestionnaire peut gérer les accès de Parent et Enfant ; Alex et Sam ont initialement Voir hérité de Parent.

## Préparations séparées et données synthétiques

- À préparer séparément avant toute campagne : déploiement Dev et commit observés, comptes synthétiques déjà autorisés et sessions privées disponibles, sélection exacte autorisée et cette version admise au catalogue.
- À préparer séparément : fixtures exclusives à cette fiche, préfixées par un identifiant de campagne ; noms, droits initiaux et contenu attendus consignés sans secrets. Aucun envoi de courriel ni création de compte n’est autorisé par la fiche.
- Design et interface du besoin implémentés et validés depuis le hand-off Claude Design. Les verbes ci-dessous décrivent des intentions UI ; ils ne prescrivent ni écran, ni composant, ni libellé inventé.
- Préparer Parent/Enfant/temoin.pdf et les trois membres synthétiques. Aucun accès explicite préalable sur Enfant.

- Parent/Enfant/temoin.pdf ; Gestionnaire, Alex, Sam.

## Actions dans l’interface

1. Comme Gestionnaire, retirer Voir à Alex uniquement sur Enfant au moyen de l’exception prévue par l’interface.
2. Comme Alex, ouvrir Parent puis essayer d’accéder à Enfant ; comme Sam, ouvrir Enfant et son témoin.
3. Comme Gestionnaire, retirer ensuite Voir à Sam sur Parent ; comme Sam, recharger et essayer d’ouvrir Enfant.
4. Comme Gestionnaire, rétablir Voir à Sam sur Parent ; comme Sam puis Alex, vérifier à nouveau l’accès à Enfant.

## Résultats visibles attendus

- Alex conserve son accès à Parent mais ne voit pas le contenu d’Enfant après l’exception.
- Sam accède initialement au témoin ; sa révocation sur Parent retire aussi cet accès à Enfant.
- Le rétablissement sur Parent rend Enfant accessible à Sam ; l’exception d’Alex reste active.
- La restriction ciblée n’ajoute aucun pouvoir et ne remplace pas les droits hérités de toutes les personnes par une copie figée.

## Effets persistants et remise en état

- Exception de restriction d’Alex sur Enfant conservée ; droit de Sam sur Parent revenu à son état initial par les gestes UI.

- Conserver les seules fixtures de cette fiche avec leurs identifiants et leur état final dans le rapport. Une suppression ou réinitialisation ultérieure exige une préparation bornée et autorisée ; aucun reset global et aucune purge irréversible pendant ce parcours.

## Arrêt et limites

- Prérequis absent, version Dev inconnue, session privée indisponible ou données non synthétiques : bloquer avant les gestes.
- Dérive du déploiement, contamination, session invalide ou mutation incertaine : arrêter et réconcilier ; aucune relance aveugle.
- Résultat visible contraire à une assertion : constater l’échec, sans changer la fiche ni réparer le produit dans cette tentative.

La rétention exacte et les bornes serveur de sept jours sont à contrôler par tests automatiques distincts. Sans attente réelle et observation UI appropriée, cette fiche ne prouve pas l’expiration à sept jours ni une échéance non affichée. Aucun état interne ne remplace une assertion UI. Les fixtures indépendantes n’imposent aucun autre parcours du catalogue.

## Sources

- docs/adr/0006-folder-tree-base.md

Ces références publiques documentent les règles attendues. Les sources détaillées des accords restent privées ; cette correction ne change ni le parcours approuvé ni ses assertions et ne transfère aucun résultat historique.
