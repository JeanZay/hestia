```json
{
  "schemaVersion": 1,
  "revision": 4,
  "status": "active",
  "theme": "Capture — guide documentaire",
  "references": [
    "docs/adr/0009-capture-classification.md",
    "docs/adr/0010-openrouter-classification.md",
    "docs/design/capture-reference-root-integration.md",
    "docs/browser-recipe.md",
    "docs/design-governance.md",
    "https://github.com/JeanZay/hestia/issues/4"
  ],
  "id": "capture-guide-acces-revoque-reprise",
  "title": "Refuser un chemin après perte d’accès puis reprendre vers une destination autorisée",
  "actor": "Auteur synthétique Membre et Gestionnaire synthétique habilité à gérer le seul dossier témoin ; sessions séparées utilisées séquentiellement.",
  "rights": [
    "Initialement Auteur possède Consulter, Déposer et Modifier sur le parent cible ; Gestionnaire peut retirer puis rétablir ce seul accès documenté.",
    "Auteur garde Consulter et Déposer dans un dossier de repli indépendant ; le retrait ne change ni rôle, ni compte, ni droits sur d’autres ressources.",
    "Gestionnaire reste autorisé à inspecter le parent après révocation ; aucun nom ou contenu du parent devenu inaccessible n’est révélé à Auteur par une nouvelle réponse."
  ],
  "preconditions": [
    "Brief et design Capture validés. Correction des fiches et retest demandés par Amaury après la campagne v2 du 11 octobre 2026. Cette proposition v3 doit être relue et son admission documentée avant exécution ; aucun PASS v2 transféré.",
    "Cible Dev et commit réellement observés, QA technique PASS du même déploiement, sélection exacte autorisée et navigateur disponible. Aucun PASS historique transféré.",
    "Comptes synthétiques déjà autorisés, sessions privées et fixtures isolées par un identifiant de campagne ; inventaire initial préparé puis constaté dans l’UI. Aucun compte, rôle, courriel ou accès réel créé implicitement.",
    "Haiku5.5 réellement qualifié et activé pour le futur candidat, conditions de transfert et dépense applicables établies ; aucune qualification actuelle cinq formats n’est présumée. Un seul déclenchement d’analyse par document ; aucune répétition automatique pour obtenir la suggestion souhaitée.",
    "Toutes les actions et assertions métier sont faites dans l’UI. Aucun appel API, SQL, interception réseau, état interne ou fournisseur simulé ne remplace un geste ou une observation. Les préparations techniques séparées ne valent pas preuves Browser Use.",
    "Le hand-off Capture racine reçu et sa revue de réception établissent le support design DS1.5/PathPlan, sous contraintes d’intégration. Avant recette, établir sur le candidat Dev effectivement déployé que les états de sélection, aperçu, confirmation, refus et reprise nécessaires sont intégrés fidèlement. La revue de réception ne remplace ni qualification du candidat, ni QA technique, ni observation UI ; aucune interface de remplacement.",
    "Parent synthétique isolé avec témoin durable et suffixe absent. État initial exact des permissions consigné ; droit retiré non réobtenu par un autre groupe ou héritage. Repli indépendant autorisé avec inventaire initial connu.",
    "Prévisualisation puis refus/récupération couverts par design validé. Deux sessions peuvent rester isolées sans perdre l’import ; sinon la fiche est bloquée, sans substitution SQL/API ni recréation de document.",
    "Avant analyse, figer les critères sémantiques : facture/garantie d’équipement pour préfixe et révocation ; acquisition/propriété immobilière pour racine. Aucun nom ni profondeur exacte ne sont imposés au modèle ; les minima techniques de chaque fiche restent requis, dont au moins deux niveaux pour la racine. Une proposition sous ce minimum produit un FAIL, sans ajout artificiel de niveau ni nouvelle analyse. Chaque suggestion existante présentée doit être positivement justifiée par le contenu ; une justification qui la déclare inadaptée est un échec distinct. Une seule analyse, jamais de relance pour obtenir le chemin voulu."
  ],
  "syntheticData": [
    "Parent BU-REF-<campagne>-revocation, témoin durable et suffixe nouveau préparé.",
    "Un seul nouveau document synthétique identifiable et dossier de repli BU-REF-<campagne>-repli, destiné à ce même Auteur."
  ],
  "objective": "Vérifier les droits à la confirmation, éviter toute création partielle après leur retrait et conserver le même document pour un classement de repli.",
  "actions": [
    "Auteur importe le fichier et déclenche une seule analyse. Consigner la proposition pertinente de garantie et son parent initial. Utiliser Changer de point de départ pour sélectionner le parent témoin de révocation si nécessaire ; cette décision appartient à l’utilisateur et n’est pas attribuée à l’IA. Ouvrir l’aperçu du chemin nouveau sous ce parent sans confirmer.",
    "Dans la session séparée Gestionnaire, retirer par l’UI l’accès d’Auteur au seul parent prévu et confirmer visiblement le retrait. Ne changer ni rôle, ni autre accès.",
    "Revenir à l’aperçu encore ouvert d’Auteur et tenter une seule confirmation. Observer le refus sans répéter la mutation ni relancer l’analyse.",
    "Gestionnaire inspecte le parent dans l’UI : vérifier témoin préservé, suffixe absent et absence de document nouvellement finalisé. Auteur reprend le même document en cours, constate ses repères, choisit manuellement le repli autorisé et ouvre un aperçu actualisé.",
    "Auteur confirme une seule fois le classement dans le repli ; après résultat confirmé, recharger et ouvrir le document. Gestionnaire restaure ensuite par l’UI uniquement les permissions initiales documentées du parent de test."
  ],
  "assertions": [
    "Le retrait d’accès après aperçu est pris en compte à la confirmation : refus visible, aucun succès trompeur et aucun détail supplémentaire du parent désormais inaccessible divulgué.",
    "Gestionnaire constate que l’échec n’a laissé ni suffixe partiel ni document final dans le parent cible ; le témoin est intact.",
    "Le même document reste disponible à Auteur selon la conservation Capture : aucune réimportation, nouvelle analyse ou copie imposée pour rejoindre le repli.",
    "L’aperçu actualisé décrit le repli et ses accès autorisés. Un seul document final y apparaît et s’ouvre après la confirmation ; l’ancien parent n’est pas réutilisé silencieusement.",
    "Seules les permissions de la fixture prévues sont restaurées ; l’état initial de ces droits est retrouvé sans élargissement.",
    "Les suggestions sont des options pertinentes, pas une liste de dossiers à rejeter. Aucun dossier sélectionnable ne présente une justification qui le déclare non pertinent. Le classement manuel reste possible."
  ],
  "persistentEffects": [
    "Au plus une analyse autorisée ; retrait temporaire puis restauration du seul accès de fixture ; un document final durable dans le repli. Aucune création dans le parent révoqué."
  ],
  "cleanup": [
    "Si la tentative s’arrête avant la restauration, la consigner comme restant à faire et, seulement si l’état est connu, rétablir via UI les permissions initiales exactes de la fixture ; aucune remise à zéro de rôle ou des droits du foyer.",
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
    "kind": "editorial",
    "actor": "root",
    "approvedAt": "2026-10-11T18:02:08.199Z",
    "proposalSha256": "8790785f2136c733d7e8bd9559ea66f12dfe121bd338fb840a616c72ff234d76",
    "decisionSha256": "1619f2b94cff436b400674096604744e4cfb98985bfdcd2f7afae736670f1c15",
    "contentSha256": "837304fb87fb6e69cbfc043588adbfa0eb9c2f2ef7a7ab02da5f1b6d723537fe",
    "contractSha256": "66e8ed1db81f88e2419d088d35c8a4802aed112048a934fd6e00b46e7e0e6403"
  }
}
```

# Refuser un chemin après perte d’accès puis reprendre vers une destination autorisée

PROPOSED v3 — NOT_RUN. Aucun résultat antérieur transféré.

## Acteur

Auteur synthétique Membre et Gestionnaire synthétique habilité à gérer le seul dossier témoin ; sessions séparées utilisées séquentiellement.

## Objectif

Vérifier les droits à la confirmation, éviter toute création partielle après leur retrait et conserver le même document pour un classement de repli.

## rights

- Initialement Auteur possède Consulter, Déposer et Modifier sur le parent cible ; Gestionnaire peut retirer puis rétablir ce seul accès documenté.
- Auteur garde Consulter et Déposer dans un dossier de repli indépendant ; le retrait ne change ni rôle, ni compte, ni droits sur d’autres ressources.
- Gestionnaire reste autorisé à inspecter le parent après révocation ; aucun nom ou contenu du parent devenu inaccessible n’est révélé à Auteur par une nouvelle réponse.

## preconditions

- Brief et design Capture validés. Correction des fiches et retest demandés par Amaury après la campagne v2 du 11 octobre 2026. Cette proposition v3 doit être relue et son admission documentée avant exécution ; aucun PASS v2 transféré.
- Cible Dev et commit réellement observés, QA technique PASS du même déploiement, sélection exacte autorisée et navigateur disponible. Aucun PASS historique transféré.
- Comptes synthétiques déjà autorisés, sessions privées et fixtures isolées par un identifiant de campagne ; inventaire initial préparé puis constaté dans l’UI. Aucun compte, rôle, courriel ou accès réel créé implicitement.
- Haiku5.5 réellement qualifié et activé pour le futur candidat, conditions de transfert et dépense applicables établies ; aucune qualification actuelle cinq formats n’est présumée. Un seul déclenchement d’analyse par document ; aucune répétition automatique pour obtenir la suggestion souhaitée.
- Toutes les actions et assertions métier sont faites dans l’UI. Aucun appel API, SQL, interception réseau, état interne ou fournisseur simulé ne remplace un geste ou une observation. Les préparations techniques séparées ne valent pas preuves Browser Use.
- Le hand-off Capture racine reçu et sa revue de réception établissent le support design DS1.5/PathPlan, sous contraintes d’intégration. Avant recette, établir sur le candidat Dev effectivement déployé que les états de sélection, aperçu, confirmation, refus et reprise nécessaires sont intégrés fidèlement. La revue de réception ne remplace ni qualification du candidat, ni QA technique, ni observation UI ; aucune interface de remplacement.
- Parent synthétique isolé avec témoin durable et suffixe absent. État initial exact des permissions consigné ; droit retiré non réobtenu par un autre groupe ou héritage. Repli indépendant autorisé avec inventaire initial connu.
- Prévisualisation puis refus/récupération couverts par design validé. Deux sessions peuvent rester isolées sans perdre l’import ; sinon la fiche est bloquée, sans substitution SQL/API ni recréation de document.
- Avant analyse, figer les critères sémantiques : facture/garantie d’équipement pour préfixe et révocation ; acquisition/propriété immobilière pour racine. Aucun nom ni profondeur exacte ne sont imposés au modèle ; les minima techniques de chaque fiche restent requis, dont au moins deux niveaux pour la racine. Une proposition sous ce minimum produit un FAIL, sans ajout artificiel de niveau ni nouvelle analyse. Chaque suggestion existante présentée doit être positivement justifiée par le contenu ; une justification qui la déclare inadaptée est un échec distinct. Une seule analyse, jamais de relance pour obtenir le chemin voulu.

## syntheticData

- Parent BU-REF-<campagne>-revocation, témoin durable et suffixe nouveau préparé.
- Un seul nouveau document synthétique identifiable et dossier de repli BU-REF-<campagne>-repli, destiné à ce même Auteur.

## actions

- Auteur importe le fichier et déclenche une seule analyse. Consigner la proposition pertinente de garantie et son parent initial. Utiliser Changer de point de départ pour sélectionner le parent témoin de révocation si nécessaire ; cette décision appartient à l’utilisateur et n’est pas attribuée à l’IA. Ouvrir l’aperçu du chemin nouveau sous ce parent sans confirmer.
- Dans la session séparée Gestionnaire, retirer par l’UI l’accès d’Auteur au seul parent prévu et confirmer visiblement le retrait. Ne changer ni rôle, ni autre accès.
- Revenir à l’aperçu encore ouvert d’Auteur et tenter une seule confirmation. Observer le refus sans répéter la mutation ni relancer l’analyse.
- Gestionnaire inspecte le parent dans l’UI : vérifier témoin préservé, suffixe absent et absence de document nouvellement finalisé. Auteur reprend le même document en cours, constate ses repères, choisit manuellement le repli autorisé et ouvre un aperçu actualisé.
- Auteur confirme une seule fois le classement dans le repli ; après résultat confirmé, recharger et ouvrir le document. Gestionnaire restaure ensuite par l’UI uniquement les permissions initiales documentées du parent de test.

## assertions

- Le retrait d’accès après aperçu est pris en compte à la confirmation : refus visible, aucun succès trompeur et aucun détail supplémentaire du parent désormais inaccessible divulgué.
- Gestionnaire constate que l’échec n’a laissé ni suffixe partiel ni document final dans le parent cible ; le témoin est intact.
- Le même document reste disponible à Auteur selon la conservation Capture : aucune réimportation, nouvelle analyse ou copie imposée pour rejoindre le repli.
- L’aperçu actualisé décrit le repli et ses accès autorisés. Un seul document final y apparaît et s’ouvre après la confirmation ; l’ancien parent n’est pas réutilisé silencieusement.
- Seules les permissions de la fixture prévues sont restaurées ; l’état initial de ces droits est retrouvé sans élargissement.
- Les suggestions sont des options pertinentes, pas une liste de dossiers à rejeter. Aucun dossier sélectionnable ne présente une justification qui le déclare non pertinent. Le classement manuel reste possible.

## persistentEffects

- Au plus une analyse autorisée ; retrait temporaire puis restauration du seul accès de fixture ; un document final durable dans le repli. Aucune création dans le parent révoqué.

## cleanup

- Si la tentative s’arrête avant la restauration, la consigner comme restant à faire et, seulement si l’état est connu, rétablir via UI les permissions initiales exactes de la fixture ; aucune remise à zéro de rôle ou des droits du foyer.
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
