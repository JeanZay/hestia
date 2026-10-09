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
    "artifacts/refinement/folder-tree-2026-10-08/dossier.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-1-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-2-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-3-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/brief-v1.md"
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-09T17:03:56.184Z",
    "proposalSha256": "652039461f66f2fecf96030748f74292ffc81094df192af72e13b93aab5a62f7",
    "decisionSha256": "f9f1471c58444642fdc59ee66d4f94c55cdf9ef60b63e7e93c9042103c8fe8de",
    "contentSha256": "c4427e599204ea1cef30c9c4d900054a55ab007d9f0986623181c122e94af950",
    "contractSha256": "76f4453a96bcff141986765687d058359867ee751723cadc7f2e022a5e4a8329"
  }
}
```

# Une exception ciblée laisse les autres droits hériter

Proposition non approuvée et non exécutée. La valeur technique status=active indique une fiche non retirée ; elle ne vaut pas admission au catalogue.

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

- artifacts/refinement/folder-tree-2026-10-08/dossier.json
- artifacts/refinement/folder-tree-2026-10-08/round-1-answer.json
- artifacts/refinement/folder-tree-2026-10-08/round-2-answer.json
- artifacts/refinement/folder-tree-2026-10-08/round-3-answer.json

Brief candidat v1 : artifacts/refinement/folder-tree-2026-10-08/brief-v1.md ; non approuvé. Les précisions nouvelles proposées dans le brief restent à valider ; cette fiche candidate ne les transforme pas en décisions.
