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
  "id": "capture-guide-racine-privee",
  "title": "Confirmer un chemin entièrement absent dans une nouvelle racine privée",
  "actor": "Auteur synthétique Membre autorisé à créer une racine ; Observateur synthétique distinct sans accès à cette future racine.",
  "rights": [
    "Auteur possède le pouvoir actuel de créer sa racine et d’y déposer ; aucun partage demandé.",
    "Observateur ne possède aucun accès documentaire à la future racine. Aucun changement de rôle dans la fiche."
  ],
  "preconditions": [
    "Brief et design Capture validés. Correction des fiches et retest demandés par Amaury après la campagne v2 du 11 octobre 2026. Cette proposition v3 doit être relue et son admission documentée avant exécution ; aucun PASS v2 transféré.",
    "Cible Dev et commit réellement observés, QA technique PASS du même déploiement, sélection exacte autorisée et navigateur disponible. Aucun PASS historique transféré.",
    "Comptes synthétiques déjà autorisés, sessions privées et fixtures isolées par un identifiant de campagne ; inventaire initial préparé puis constaté dans l’UI. Aucun compte, rôle, courriel ou accès réel créé implicitement.",
    "Haiku5.5 réellement qualifié et activé pour le futur candidat, conditions de transfert et dépense applicables établies ; aucune qualification actuelle cinq formats n’est présumée. Un seul déclenchement d’analyse par document ; aucune répétition automatique pour obtenir la suggestion souhaitée.",
    "Toutes les actions et assertions métier sont faites dans l’UI. Aucun appel API, SQL, interception réseau, état interne ou fournisseur simulé ne remplace un geste ou une observation. Les préparations techniques séparées ne valent pas preuves Browser Use.",
    "Le hand-off Capture racine reçu et sa revue de réception établissent le support design DS1.5/PathPlan, sous contraintes d’intégration. Avant recette, établir sur le candidat Dev effectivement déployé que les états de sélection, aperçu, confirmation, refus et reprise nécessaires sont intégrés fidèlement. La revue de réception ne remplace ni qualification du candidat, ni QA technique, ni observation UI ; aucune interface de remplacement.",
    "Avant le geste racine, établir que le candidat Dev identifié expose réellement la sélection et la confirmation Capture sans parent existant, avec aperçu des niveaux et racine privée, selon le complément reçu. Le design n’est plus manquant ; l’intégration déployée et ses prérequis doivent être observés, sans PASS futur présumé.",
    "Inventaires initiaux des deux comptes connus. Le document décrit un bien fictif identifié et une acquisition, mais ne dicte aucun nom de dossier au modèle. L’absence du chemin retenu sera vérifiée dans Capture avant confirmation. Le chemin doit comporter au moins deux niveaux nouveaux pour exercer la création multiple.",
    "Avant analyse, figer les critères sémantiques : facture/garantie d’équipement pour préfixe et révocation ; acquisition/propriété immobilière pour racine. Aucun nom ni profondeur exacte ne sont imposés au modèle ; les minima techniques de chaque fiche restent requis, dont au moins deux niveaux pour la racine. Une proposition sous ce minimum produit un FAIL, sans ajout artificiel de niveau ni nouvelle analyse. Chaque suggestion existante présentée doit être positivement justifiée par le contenu ; une justification qui la déclare inadaptée est un échec distinct. Une seule analyse, jamais de relance pour obtenir le chemin voulu."
  ],
  "syntheticData": [
    "Acte synthétique d’acquisition d’un bien fictif identifié par un marqueur unique. Les noms du chemin proposé peuvent suivre le guide immobilier et varient sans modifier le critère sémantique.",
    "Observateur et Auteur sont des comptes de test déjà autorisés ; leurs identifiants d’authentification ne figurent pas dans la fiche."
  ],
  "objective": "Créer uniquement après confirmation le chemin proposé sans parent existant, puis vérifier visiblement sa confidentialité et l’unicité du document.",
  "actions": [
    "Avec Auteur, consigner l’inventaire initial et importer le document synthétique sans dossier courant.",
    "Déclencher une seule analyse. Consigner un chemin pertinent pour acquisition/propriété comportant au moins deux niveaux. Choisir le point de départ privé dans l’UI si nécessaire, en consignant ce changement utilisateur. Si le nom de racine existe déjà, utiliser le champ de nom existant pour lui ajouter le marqueur synthétique de campagne, sans changer son sens. Fixer le chemin complet retenu avant tout aperçu ou confirmation.",
    "Sans fermer le même import, vérifier dans la navigation intégrée que rien n’est encore créé ; revenir au même aperçu et confirmer une seule fois.",
    "Après résultat confirmé, recharger, ouvrir la racine et le document. Dans une session séparée Observateur, vérifier par navigation et recherche UI que cette racine et ce document restent inaccessibles ; ne pas transmettre d’URL privée à l’autre compte."
  ],
  "assertions": [
    "L’analyse, la sélection et l’aperçu ne créent aucun dossier ou document final.",
    "L’aperçu indique le chemin complet et une racine privée à Auteur, sans partage automatique ni variable littérale telle que [personne].",
    "Après confirmation, une seule racine portant le nom retenu dans l’aperçu, tous et seulement les niveaux confirmés (au moins deux), et un unique document final sont visibles. Le document s’ouvre avec ses repères synthétiques. Aucun nom littéral particulier n’est exigé de l’IA.",
    "Observateur ne voit ni la racine ni son document dans la navigation ou les résultats de recherche. La couverture exhaustive des refus serveur reste distincte de cette observation UI.",
    "Les suggestions sont des options pertinentes, pas une liste de dossiers à rejeter. Aucun dossier sélectionnable ne présente une justification qui le déclare non pertinent. Le classement manuel reste possible."
  ],
  "persistentEffects": [
    "Une analyse autorisée dans la future campagne, une racine privée et son chemin confirmé, un document synthétique durable. Aucun compte, partage ou accès d’Observateur créé."
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
    "kind": "editorial",
    "actor": "root",
    "approvedAt": "2026-10-11T18:02:08.183Z",
    "proposalSha256": "f5f25f2708777749030f49f41f4e83591245a93bf0017e5fe1b382928cc9938d",
    "decisionSha256": "fca99b211de6ac1f9e96ab03f9ef59b22dcc4a966324a9dadeb700e28e1aafbf",
    "contentSha256": "40c121b2a9bcff7905b06bbb9d1e0fc043f512cae01516f6447691742954580b",
    "contractSha256": "852c0133c34eebcba47d32b4fc98be2a7e3c68604d12394f37008da4ab1b47d0"
  }
}
```

# Confirmer un chemin entièrement absent dans une nouvelle racine privée

PROPOSED v3 — NOT_RUN. Aucun résultat antérieur transféré.

## Acteur

Auteur synthétique Membre autorisé à créer une racine ; Observateur synthétique distinct sans accès à cette future racine.

## Objectif

Créer uniquement après confirmation le chemin proposé sans parent existant, puis vérifier visiblement sa confidentialité et l’unicité du document.

## rights

- Auteur possède le pouvoir actuel de créer sa racine et d’y déposer ; aucun partage demandé.
- Observateur ne possède aucun accès documentaire à la future racine. Aucun changement de rôle dans la fiche.

## preconditions

- Brief et design Capture validés. Correction des fiches et retest demandés par Amaury après la campagne v2 du 11 octobre 2026. Cette proposition v3 doit être relue et son admission documentée avant exécution ; aucun PASS v2 transféré.
- Cible Dev et commit réellement observés, QA technique PASS du même déploiement, sélection exacte autorisée et navigateur disponible. Aucun PASS historique transféré.
- Comptes synthétiques déjà autorisés, sessions privées et fixtures isolées par un identifiant de campagne ; inventaire initial préparé puis constaté dans l’UI. Aucun compte, rôle, courriel ou accès réel créé implicitement.
- Haiku5.5 réellement qualifié et activé pour le futur candidat, conditions de transfert et dépense applicables établies ; aucune qualification actuelle cinq formats n’est présumée. Un seul déclenchement d’analyse par document ; aucune répétition automatique pour obtenir la suggestion souhaitée.
- Toutes les actions et assertions métier sont faites dans l’UI. Aucun appel API, SQL, interception réseau, état interne ou fournisseur simulé ne remplace un geste ou une observation. Les préparations techniques séparées ne valent pas preuves Browser Use.
- Le hand-off Capture racine reçu et sa revue de réception établissent le support design DS1.5/PathPlan, sous contraintes d’intégration. Avant recette, établir sur le candidat Dev effectivement déployé que les états de sélection, aperçu, confirmation, refus et reprise nécessaires sont intégrés fidèlement. La revue de réception ne remplace ni qualification du candidat, ni QA technique, ni observation UI ; aucune interface de remplacement.
- Avant le geste racine, établir que le candidat Dev identifié expose réellement la sélection et la confirmation Capture sans parent existant, avec aperçu des niveaux et racine privée, selon le complément reçu. Le design n’est plus manquant ; l’intégration déployée et ses prérequis doivent être observés, sans PASS futur présumé.
- Inventaires initiaux des deux comptes connus. Le document décrit un bien fictif identifié et une acquisition, mais ne dicte aucun nom de dossier au modèle. L’absence du chemin retenu sera vérifiée dans Capture avant confirmation. Le chemin doit comporter au moins deux niveaux nouveaux pour exercer la création multiple.
- Avant analyse, figer les critères sémantiques : facture/garantie d’équipement pour préfixe et révocation ; acquisition/propriété immobilière pour racine. Aucun nom ni profondeur exacte ne sont imposés au modèle ; les minima techniques de chaque fiche restent requis, dont au moins deux niveaux pour la racine. Une proposition sous ce minimum produit un FAIL, sans ajout artificiel de niveau ni nouvelle analyse. Chaque suggestion existante présentée doit être positivement justifiée par le contenu ; une justification qui la déclare inadaptée est un échec distinct. Une seule analyse, jamais de relance pour obtenir le chemin voulu.

## syntheticData

- Acte synthétique d’acquisition d’un bien fictif identifié par un marqueur unique. Les noms du chemin proposé peuvent suivre le guide immobilier et varient sans modifier le critère sémantique.
- Observateur et Auteur sont des comptes de test déjà autorisés ; leurs identifiants d’authentification ne figurent pas dans la fiche.

## actions

- Avec Auteur, consigner l’inventaire initial et importer le document synthétique sans dossier courant.
- Déclencher une seule analyse. Consigner un chemin pertinent pour acquisition/propriété comportant au moins deux niveaux. Choisir le point de départ privé dans l’UI si nécessaire, en consignant ce changement utilisateur. Si le nom de racine existe déjà, utiliser le champ de nom existant pour lui ajouter le marqueur synthétique de campagne, sans changer son sens. Fixer le chemin complet retenu avant tout aperçu ou confirmation.
- Sans fermer le même import, vérifier dans la navigation intégrée que rien n’est encore créé ; revenir au même aperçu et confirmer une seule fois.
- Après résultat confirmé, recharger, ouvrir la racine et le document. Dans une session séparée Observateur, vérifier par navigation et recherche UI que cette racine et ce document restent inaccessibles ; ne pas transmettre d’URL privée à l’autre compte.

## assertions

- L’analyse, la sélection et l’aperçu ne créent aucun dossier ou document final.
- L’aperçu indique le chemin complet et une racine privée à Auteur, sans partage automatique ni variable littérale telle que [personne].
- Après confirmation, une seule racine portant le nom retenu dans l’aperçu, tous et seulement les niveaux confirmés (au moins deux), et un unique document final sont visibles. Le document s’ouvre avec ses repères synthétiques. Aucun nom littéral particulier n’est exigé de l’IA.
- Observateur ne voit ni la racine ni son document dans la navigation ou les résultats de recherche. La couverture exhaustive des refus serveur reste distincte de cette observation UI.
- Les suggestions sont des options pertinentes, pas une liste de dossiers à rejeter. Aucun dossier sélectionnable ne présente une justification qui le déclare non pertinent. Le classement manuel reste possible.

## persistentEffects

- Une analyse autorisée dans la future campagne, une racine privée et son chemin confirmé, un document synthétique durable. Aucun compte, partage ou accès d’Observateur créé.

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
