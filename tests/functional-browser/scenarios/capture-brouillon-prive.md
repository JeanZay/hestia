```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "Capture et classement",
  "actor": "Membres synthétiques autorisés, désignés par alias ; aucune création de compte dans la fiche",
  "references": [
    "docs/adr/0009-capture-classification.md",
    "docs/browser-recipe.md"
  ],
  "preconditions": [
    "Avant toute campagne : déploiement Dev et commit réellement observés, QA technique établie, cette version admise et sélection exacte autorisée. Une proposition ne vaut ni admission ni exécution.",
    "Comptes synthétiques déjà autorisés et sessions privées disponibles ; fixtures exclusives préfixées BU-CAP-<campagne>-<fiche>, inventaire UI initial et noms attendus consignés sans secrets. Pas de données familiales, création de compte, courriel ou changement de rôle implicite.",
    "Actions et assertions métier exclusivement dans l’UI avec les API documentées de Browser Use. Aucun SQL, appel API Hestia, état interne ou interception réseau. Les étapes décrivent le comportement validé, sans concevoir une interface.",
    "Deux sessions privées séparées et autorisées. Les dates des fixtures et sauvegardes confirmées sont connues ; faute de fixture expirée réellement préparée, la fiche ne peut pas être PASS."
  ],
  "cleanup": [
    "Conserver les seules fixtures de cette fiche et leur état final dans le rapport ; aucune purge irréversible ni reset global. Les temporaires suivent le cycle normal du produit ; leur disparition de l’UI ne prouve pas un effacement physique."
  ],
  "stopConditions": [
    "Prérequis manquant, cible inconnue, outil incapable de réaliser un geste ou donnée non synthétique : bloquer avant ce geste ; ne pas remplacer une assertion par une preuve technique.",
    "Session invalide, dérive de déploiement, contamination ou mutation incertaine : arrêter la campagne et réconcilier avant toute nouvelle sélection. Ne jamais rejouer aveuglément une finalisation.",
    "Assertion visible contredite : constater FAIL sans affaiblir la fiche ni réparer le produit dans la tentative. Aucun résultat actuel n’est repris d’un ancien PASS."
  ],
  "dependencies": [],
  "id": "capture-brouillon-prive",
  "title": "Reprendre les pages confirmées sans exposer le brouillon à un autre membre",
  "objective": "Reprendre les pages confirmées sans exposer le brouillon à un autre membre",
  "rights": [
    "Auteur peut consulter son brouillon ; Tiers est Administrateur actif déjà autorisé pour le test, sans droit sur ce brouillon ni le dossier privé Auteur. Aucun changement de rôle."
  ],
  "syntheticData": [
    "Un brouillon Auteur non expiré comportant deux pages confirmées, titre unique, date de création et échéance consignées depuis une préparation autorisée. Un brouillon synthétique expiré dont l’identité et l’échéance ont été consignées avant expiration, sans changement d’horloge du service."
  ],
  "actions": [
    "Comme Auteur, ouvrir Brouillons, observer l’échéance, reprendre le brouillon non expiré et identifier les deux pages.",
    "Fermer la vue puis la session ; se reconnecter par transfert privé autorisé et reprendre le même brouillon.",
    "Comme Tiers dans sa session séparée, ouvrir Brouillons et les dossiers accessibles sans manipuler d’URL ni appeler une API.",
    "Comme Auteur, vérifier que le brouillon expiré n’est plus récupérable dans l’interface, sans tenter une réactivation technique."
  ],
  "assertions": [
    "Auteur récupère exactement les pages confirmées ; la date limite affichée correspond à sept jours après création et ne s’allonge pas après reprise.",
    "Tiers ne voit ni titre, vignette ni contenu du brouillon Auteur ; son rôle Administrateur ne change pas ce résultat.",
    "Le brouillon expiré n’est pas reprenable dans l’UI ; aucune promesse de récupération d’une page non confirmée n’est affichée."
  ],
  "persistentEffects": [
    "Brouillon non expiré conservé sans finalisation ; sessions authentifiées utilisées puis fermées au terme de la campagne."
  ],
  "approval": {
    "kind": "editorial",
    "actor": "haiku_candidate_review",
    "approvedAt": "2026-10-10T22:50:12.717Z",
    "proposalSha256": "4fb4135e8451ea4aa73b8aacfa72f20de9c3e4c843e93ccdce4f589b631cd82f",
    "decisionSha256": "88d826cf4bb3c1dfc2b793c273d2926c88090cae8883260c6e0d0988cfc80b1a",
    "contentSha256": "d0b832f74f56491b37ed3b28a622abbc3c2c80bf327f6180ec9a2a0cd1e9bc41",
    "contractSha256": "535383e5486c69865e5fa75a8dde8f0eb7019ebad69dc87e3f7a57b0ac03f994"
  }
}
```

# Reprendre les pages confirmées sans exposer le brouillon à un autre membre

Fiche admise ; révision éditoriale des références publiques. Aucun parcours exécuté ni résultat antérieur repris (NOT_RUN).

Critères : DRAFT, RETENTION, RIGHTS.

## Acteurs et droits

- Auteur peut consulter son brouillon ; Tiers est Administrateur actif déjà autorisé pour le test, sans droit sur ce brouillon ni le dossier privé Auteur. Aucun changement de rôle.

## Préconditions et préparation séparée

- Avant toute campagne : déploiement Dev et commit réellement observés, QA technique établie, cette version admise et sélection exacte autorisée. Une proposition ne vaut ni admission ni exécution.
- Comptes synthétiques déjà autorisés et sessions privées disponibles ; fixtures exclusives préfixées BU-CAP-<campagne>-<fiche>, inventaire UI initial et noms attendus consignés sans secrets. Pas de données familiales, création de compte, courriel ou changement de rôle implicite.
- Actions et assertions métier exclusivement dans l’UI avec les API documentées de Browser Use. Aucun SQL, appel API Hestia, état interne ou interception réseau. Les étapes décrivent le comportement validé, sans concevoir une interface.
- Deux sessions privées séparées et autorisées. Les dates des fixtures et sauvegardes confirmées sont connues ; faute de fixture expirée réellement préparée, la fiche ne peut pas être PASS.

## Données synthétiques

- Un brouillon Auteur non expiré comportant deux pages confirmées, titre unique, date de création et échéance consignées depuis une préparation autorisée. Un brouillon synthétique expiré dont l’identité et l’échéance ont été consignées avant expiration, sans changement d’horloge du service.

## Actions UI

- Comme Auteur, ouvrir Brouillons, observer l’échéance, reprendre le brouillon non expiré et identifier les deux pages.
- Fermer la vue puis la session ; se reconnecter par transfert privé autorisé et reprendre le même brouillon.
- Comme Tiers dans sa session séparée, ouvrir Brouillons et les dossiers accessibles sans manipuler d’URL ni appeler une API.
- Comme Auteur, vérifier que le brouillon expiré n’est plus récupérable dans l’interface, sans tenter une réactivation technique.

## Assertions attendues

- Auteur récupère exactement les pages confirmées ; la date limite affichée correspond à sept jours après création et ne s’allonge pas après reprise.
- Tiers ne voit ni titre, vignette ni contenu du brouillon Auteur ; son rôle Administrateur ne change pas ce résultat.
- Le brouillon expiré n’est pas reprenable dans l’UI ; aucune promesse de récupération d’une page non confirmée n’est affichée.

## Effets persistants

- Brouillon non expiré conservé sans finalisation ; sessions authentifiées utilisées puis fermées au terme de la campagne.

## Remise en état

- Conserver les seules fixtures de cette fiche et leur état final dans le rapport ; aucune purge irréversible ni reset global. Les temporaires suivent le cycle normal du produit ; leur disparition de l’UI ne prouve pas un effacement physique.

## Arrêt

- Prérequis manquant, cible inconnue, outil incapable de réaliser un geste ou donnée non synthétique : bloquer avant ce geste ; ne pas remplacer une assertion par une preuve technique.
- Session invalide, dérive de déploiement, contamination ou mutation incertaine : arrêter la campagne et réconcilier avant toute nouvelle sélection. Ne jamais rejouer aveuglément une finalisation.
- Assertion visible contredite : constater FAIL sans affaiblir la fiche ni réparer le produit dans la tentative. Aucun résultat actuel n’est repris d’un ancien PASS.

## Limites de preuve

- Une absence dans une liste ne qualifie pas tous les refus serveur ; les tests d’accès direct, admission révoquée et expiration concurrente restent complémentaires. Sept jours réels ou fixture préexistante documentée, jamais horloge serveur changée.
