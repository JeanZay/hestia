```json
{
  "schemaVersion": 1,
  "revision": 5,
  "status": "retired",
  "theme": "Capture — guide documentaire",
  "references": [
    "docs/adr/0009-capture-classification.md",
    "docs/adr/0010-openrouter-classification.md",
    "docs/design/capture-reference-root-integration.md",
    "docs/browser-recipe.md",
    "docs/design-governance.md",
    "https://github.com/JeanZay/hestia/issues/4"
  ],
  "id": "capture-guide-prefixe-suffixe",
  "title": "Réutiliser un préfixe existant et confirmer son suffixe manquant",
  "actor": "Auteur synthétique Membre ; compte distinct d’une éventuelle personne citée dans le document.",
  "rights": [
    "Auteur possède Consulter, Déposer et Modifier sur le préfixe synthétique préparé ; aucun droit obtenu du guide ou du rôle de gestionnaire IA.",
    "L’aperçu des accès reste limité à ses droits : noms des personnes uniquement si autorisés, sinon capacités propres et indication neutre."
  ],
  "preconditions": [
    "Brief et design Capture validés. Correction des fiches et retest demandés par Amaury après la campagne v2 du 11 octobre 2026. Cette proposition v3 doit être relue et son admission documentée avant exécution ; aucun PASS v2 transféré.",
    "Cible Dev et commit réellement observés, QA technique PASS du même déploiement, sélection exacte autorisée et navigateur disponible. Aucun PASS historique transféré.",
    "Comptes synthétiques déjà autorisés, sessions privées et fixtures isolées par un identifiant de campagne ; inventaire initial préparé puis constaté dans l’UI. Aucun compte, rôle, courriel ou accès réel créé implicitement.",
    "Haiku5.5 réellement qualifié et activé pour le futur candidat, conditions de transfert et dépense applicables établies ; aucune qualification actuelle cinq formats n’est présumée. Un seul déclenchement d’analyse par document ; aucune répétition automatique pour obtenir la suggestion souhaitée.",
    "Toutes les actions et assertions métier sont faites dans l’UI. Aucun appel API, SQL, interception réseau, état interne ou fournisseur simulé ne remplace un geste ou une observation. Les préparations techniques séparées ne valent pas preuves Browser Use.",
    "Le hand-off Capture racine reçu et sa revue de réception établissent le support design DS1.5/PathPlan, sous contraintes d’intégration. Avant recette, établir sur le candidat Dev effectivement déployé que les états de sélection, aperçu, confirmation, refus et reprise nécessaires sont intégrés fidèlement. La revue de réception ne remplace ni qualification du candidat, ni QA technique, ni observation UI ; aucune interface de remplacement.",
    "Préfixe isolé accessible contenant un témoin durable, avec aucun suffixe de garantie existant. Aucun homonyme ambigu. La création de plusieurs niveaux est exercée séparément par la fiche racine v3, et ne dépend pas ici d’une profondeur imposée au modèle.",
    "Avant analyse, figer les critères sémantiques : facture/garantie d’équipement pour préfixe et révocation ; acquisition/propriété immobilière pour racine. Aucun nom ni profondeur exacte ne sont imposés au modèle ; les minima techniques de chaque fiche restent requis, dont au moins deux niveaux pour la racine. Une proposition sous ce minimum produit un FAIL, sans ajout artificiel de niveau ni nouvelle analyse. Chaque suggestion existante présentée doit être positivement justifiée par le contenu ; une justification qui la déclare inadaptée est un échec distinct. Une seule analyse, jamais de relance pour obtenir le chemin voulu."
  ],
  "syntheticData": [
    "Préfixe BU-REF-<campagne>-suffixe / Équipements, document témoin au contenu SYNTHÉTIQUE.",
    "Facture et garantie fictives d’un équipement identifié. Le suffixe proposé doit avoir un sens documentaire pertinent ; au moins un niveau manquant. Le point de départ de test est connu et accessible."
  ],
  "objective": "Constater que le chemin choisi reprend le préfixe déjà visible et crée seulement son suffixe après confirmation, avec un seul document final.",
  "actions": [
    "Dans l’UI, ouvrir le préfixe préparé et constater son document témoin ainsi que l’absence du suffixe. Importer ensuite le nouveau fichier synthétique sans finaliser.",
    "Déclencher une seule analyse. Lire et consigner la proposition sémantiquement pertinente et son point de départ initial. Avec le contrôle existant Changer de point de départ si nécessaire, choisir le préfixe témoin préparé ; consigner explicitement cette intervention humaine. Choisir le chemin ainsi préparé sans changer le sens du suffixe.",
    "Ouvrir l’aperçu avant confirmation : distinguer les niveaux existants et nouveaux ainsi que les accès autorisés. Depuis la navigation intégrée de Capture, vérifier que les nouveaux niveaux sont toujours absents, puis revenir au même aperçu sans fermer l’import ni relancer l’analyse.",
    "Confirmer explicitement une fois. Après le résultat confirmé, recharger l’UI et ouvrir le préfixe, son suffixe et le document final."
  ],
  "assertions": [
    "Aucun dossier ni document final n’apparaît à l’analyse ou à la seule sélection. Le classement manuel reste disponible.",
    "L’aperçu montre le chemin complet, le préfixe réutilisé, tous les niveaux manquants (au moins un) et les accès autorisés, sans fuite nominative.",
    "Après confirmation, le préfixe témoin est réutilisé sans duplication. Tous et seulement les niveaux confirmés sont présents, avec un unique document final. Les adaptations faites par l’utilisateur restent distinguées de la proposition initiale.",
    "Le document final s’ouvre avec ses repères attendus. Le témoin et son classement sont préservés après rechargement. L’UI ne prétend pas prouver l’identité SQL : la stabilité interne des identifiants reste une preuve technique distincte.",
    "Les suggestions sont des options pertinentes, pas une liste de dossiers à rejeter. Aucun dossier sélectionnable ne présente une justification qui le déclare non pertinent. Le classement manuel reste possible."
  ],
  "persistentEffects": [
    "Au plus une analyse, le suffixe confirmé sous le préfixe préparé et un document final. Préfixe, témoin et droits initiaux préservés."
  ],
  "cleanup": [
    "Conserver le document final synthétique, son original et les dossiers créés avec l’état final de cette tentative ; aucune purge durable ou réorganisation globale. Consigner les ressources de la seule fiche et les éventuels temporaires restants.",
    "Les temporaires suivent leur cycle normal. Un nettoyage technique distinct exige provenance individuelle, éligibilité, inventaire borné et revue selon l’accord durable ; ne pas invoquer une maintenance globale dans la recette. La disparition dans l’UI ne prouve pas l’effacement physique.",
    "Terminer les sessions de test ouvertes pour la fiche sans modifier les autres comptes ou données."
  ],
  "stopConditions": [
    "Prérequis absent, design nécessaire manquant, cible inconnue, compte non synthétique ou capacité Browser Use insuffisante : BLOCKED avant le geste concerné.",
    "Assertion visible contredite ou suggestion requise absente après l’unique analyse : FAIL, sans changer les critères, réparer le produit ni relancer pour obtenir un succès.",
    "Session invalide, déploiement modifié, données contaminées ou résultat de mutation incertain : arrêter et réconcilier avant une nouvelle tentative autorisée. Ne pas rejouer une confirmation à effet inconnu.",
    "Ne jamais enregistrer mot de passe, cookie, lien signé ou contenu personnel dans les observations ou captures."
  ],
  "dependencies": [],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-12T06:45:18.934Z",
    "proposalSha256": "237da2577deacf41d93b9f29a100c6c8e9da3826cc6c04310f5f994997e34186",
    "decisionSha256": "d6acded58cfb2eca4c93f811f704c6bba17b49f21c912109226bad0d46928755",
    "contentSha256": "d2743593a7b70b32604dc2d8ed31af3dfd7c7246809c3f0581aaa7ef61614c3c",
    "contractSha256": "aa793ecd93ef9c282bc824af2227efa52dd9fc0de36f96d368d755cc1f73ac52"
  }
}
```

# Retrait proposé de la fiche préfixe + suffixe

PROPOSITION — NON ADMISE. Le contrat historique ci-dessous est conservé pour interpréter ses anciennes tentatives. Il exigeait un nouveau chemin à chaque analyse. Le retrait proposé sépare maintenant la pertinence des suggestions (nouvelle fiche capture-suggestions-pertinentes r1) de la création d’arborescence (contrôles techniques déterministes). Aucun FAIL historique n’est effacé et aucun PASS n’est transféré. Cette fiche retirée ne doit plus être sélectionnée après son admission.

# Réutiliser un préfixe existant et confirmer son suffixe manquant

PROPOSED v3 — NOT_RUN. Aucun résultat antérieur transféré.

## Acteur

Auteur synthétique Membre ; compte distinct d’une éventuelle personne citée dans le document.

## Objectif

Constater que le chemin choisi reprend le préfixe déjà visible et crée seulement son suffixe après confirmation, avec un seul document final.

## rights

- Auteur possède Consulter, Déposer et Modifier sur le préfixe synthétique préparé ; aucun droit obtenu du guide ou du rôle de gestionnaire IA.
- L’aperçu des accès reste limité à ses droits : noms des personnes uniquement si autorisés, sinon capacités propres et indication neutre.

## preconditions

- Brief et design Capture validés. Correction des fiches et retest demandés par Amaury après la campagne v2 du 11 octobre 2026. Cette proposition v3 doit être relue et son admission documentée avant exécution ; aucun PASS v2 transféré.
- Cible Dev et commit réellement observés, QA technique PASS du même déploiement, sélection exacte autorisée et navigateur disponible. Aucun PASS historique transféré.
- Comptes synthétiques déjà autorisés, sessions privées et fixtures isolées par un identifiant de campagne ; inventaire initial préparé puis constaté dans l’UI. Aucun compte, rôle, courriel ou accès réel créé implicitement.
- Haiku5.5 réellement qualifié et activé pour le futur candidat, conditions de transfert et dépense applicables établies ; aucune qualification actuelle cinq formats n’est présumée. Un seul déclenchement d’analyse par document ; aucune répétition automatique pour obtenir la suggestion souhaitée.
- Toutes les actions et assertions métier sont faites dans l’UI. Aucun appel API, SQL, interception réseau, état interne ou fournisseur simulé ne remplace un geste ou une observation. Les préparations techniques séparées ne valent pas preuves Browser Use.
- Le hand-off Capture racine reçu et sa revue de réception établissent le support design DS1.5/PathPlan, sous contraintes d’intégration. Avant recette, établir sur le candidat Dev effectivement déployé que les états de sélection, aperçu, confirmation, refus et reprise nécessaires sont intégrés fidèlement. La revue de réception ne remplace ni qualification du candidat, ni QA technique, ni observation UI ; aucune interface de remplacement.
- Préfixe isolé accessible contenant un témoin durable, avec aucun suffixe de garantie existant. Aucun homonyme ambigu. La création de plusieurs niveaux est exercée séparément par la fiche racine v3, et ne dépend pas ici d’une profondeur imposée au modèle.
- Avant analyse, figer les critères sémantiques : facture/garantie d’équipement pour préfixe et révocation ; acquisition/propriété immobilière pour racine. Aucun nom ni profondeur exacte ne sont imposés au modèle ; les minima techniques de chaque fiche restent requis, dont au moins deux niveaux pour la racine. Une proposition sous ce minimum produit un FAIL, sans ajout artificiel de niveau ni nouvelle analyse. Chaque suggestion existante présentée doit être positivement justifiée par le contenu ; une justification qui la déclare inadaptée est un échec distinct. Une seule analyse, jamais de relance pour obtenir le chemin voulu.

## syntheticData

- Préfixe BU-REF-<campagne>-suffixe / Équipements, document témoin au contenu SYNTHÉTIQUE.
- Facture et garantie fictives d’un équipement identifié. Le suffixe proposé doit avoir un sens documentaire pertinent ; au moins un niveau manquant. Le point de départ de test est connu et accessible.

## actions

- Dans l’UI, ouvrir le préfixe préparé et constater son document témoin ainsi que l’absence du suffixe. Importer ensuite le nouveau fichier synthétique sans finaliser.
- Déclencher une seule analyse. Lire et consigner la proposition sémantiquement pertinente et son point de départ initial. Avec le contrôle existant Changer de point de départ si nécessaire, choisir le préfixe témoin préparé ; consigner explicitement cette intervention humaine. Choisir le chemin ainsi préparé sans changer le sens du suffixe.
- Ouvrir l’aperçu avant confirmation : distinguer les niveaux existants et nouveaux ainsi que les accès autorisés. Depuis la navigation intégrée de Capture, vérifier que les nouveaux niveaux sont toujours absents, puis revenir au même aperçu sans fermer l’import ni relancer l’analyse.
- Confirmer explicitement une fois. Après le résultat confirmé, recharger l’UI et ouvrir le préfixe, son suffixe et le document final.

## assertions

- Aucun dossier ni document final n’apparaît à l’analyse ou à la seule sélection. Le classement manuel reste disponible.
- L’aperçu montre le chemin complet, le préfixe réutilisé, tous les niveaux manquants (au moins un) et les accès autorisés, sans fuite nominative.
- Après confirmation, le préfixe témoin est réutilisé sans duplication. Tous et seulement les niveaux confirmés sont présents, avec un unique document final. Les adaptations faites par l’utilisateur restent distinguées de la proposition initiale.
- Le document final s’ouvre avec ses repères attendus. Le témoin et son classement sont préservés après rechargement. L’UI ne prétend pas prouver l’identité SQL : la stabilité interne des identifiants reste une preuve technique distincte.
- Les suggestions sont des options pertinentes, pas une liste de dossiers à rejeter. Aucun dossier sélectionnable ne présente une justification qui le déclare non pertinent. Le classement manuel reste possible.

## persistentEffects

- Au plus une analyse, le suffixe confirmé sous le préfixe préparé et un document final. Préfixe, témoin et droits initiaux préservés.

## cleanup

- Conserver le document final synthétique, son original et les dossiers créés avec l’état final de cette tentative ; aucune purge durable ou réorganisation globale. Consigner les ressources de la seule fiche et les éventuels temporaires restants.
- Les temporaires suivent leur cycle normal. Un nettoyage technique distinct exige provenance individuelle, éligibilité, inventaire borné et revue selon l’accord durable ; ne pas invoquer une maintenance globale dans la recette. La disparition dans l’UI ne prouve pas l’effacement physique.
- Terminer les sessions de test ouvertes pour la fiche sans modifier les autres comptes ou données.

## stopConditions

- Prérequis absent, design nécessaire manquant, cible inconnue, compte non synthétique ou capacité Browser Use insuffisante : BLOCKED avant le geste concerné.
- Assertion visible contredite ou suggestion requise absente après l’unique analyse : FAIL, sans changer les critères, réparer le produit ni relancer pour obtenir un succès.
- Session invalide, déploiement modifié, données contaminées ou résultat de mutation incertain : arrêter et réconcilier avant une nouvelle tentative autorisée. Ne pas rejouer une confirmation à effet inconnu.
- Ne jamais enregistrer mot de passe, cookie, lien signé ou contenu personnel dans les observations ou captures.

## Références publiques de cette révision

Correction éditoriale des seules références vers les ADR, la correspondance du hand-off et les règles publiques du projet. Les critères métier de la proposition v3 approuvée restent identiques. Les accords, revues et résultats détaillés demeurent dans les preuves locales ; aucun résultat Browser Use n’est transféré.
