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
    "Brouillon préparé séparément, origine documentée et pages visuellement distinctes. Aucun fichier injecté ne sera présenté comme une prise de vue réelle."
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
  "id": "capture-multipage-ajustements",
  "title": "Ajuster des pages sauvegardées et produire le PDF retenu",
  "objective": "Ajuster des pages sauvegardées et produire le PDF retenu",
  "rights": [
    "Auteur possède Consulter, Déposer et Exporter dans le dossier dédié."
  ],
  "syntheticData": [
    "Brouillon caméra de trois pages synthétiques confirmées, avec repères A, B, C distincts et bordures de recadrage ; dossier vide et titre unique."
  ],
  "actions": [
    "Reprendre le brouillon ; déplacer B avant A ; tourner B ; recadrer A avec les contrôles UI ; retirer C.",
    "Fermer puis reprendre le même brouillon, vérifier l’ordre B/A et les ajustements persistants. Continuer.",
    "Observer le format PDF multipage, saisir le titre, parcourir vers le dossier autorisé, vérifier les accès et confirmer une seule fois.",
    "Ouvrir le document puis télécharger le PDF via l’UI ; examiner les deux pages avec un visualiseur local autorisé et rapprocher les repères et recadrages des aperçus."
  ],
  "assertions": [
    "Deux pages B puis A subsistent après reprise ; C est absente. Rotation et recadrage correspondent aux choix visibles.",
    "Plusieurs pages produisent un PDF ; aucune option Image ne prétend représenter l’ensemble multipage.",
    "Le PDF téléchargé contient exactement B puis A, avec rotation/recadrage validés et sans C ; un document final unique persiste.",
    "Aucune analyse n’est nécessaire pour classer manuellement."
  ],
  "persistentEffects": [
    "Un document PDF synthétique durable, un brouillon finalisé et des temporaires à purger."
  ],
  "approval": {
    "kind": "editorial",
    "actor": "haiku_candidate_review",
    "approvedAt": "2026-10-10T22:50:13.394Z",
    "proposalSha256": "05fe0d186f00ca445e6981710d0842e10ef8f8489312747ca5d089b07c9eb382",
    "decisionSha256": "027129713bf28c5009e80a829f1a824b99b99953e351ac0d3cd6f6f608b9c901",
    "contentSha256": "9ccd3cca20d23c17afc3c74a0c548068e59ea4e7658a485639168fb6177ea817",
    "contractSha256": "eae08fd147500adb9b9075001cf92880cc816980449289a0773478a0c454c916"
  }
}
```

# Ajuster des pages sauvegardées et produire le PDF retenu

Fiche admise ; révision éditoriale des références publiques. Aucun parcours exécuté ni résultat antérieur repris (NOT_RUN).

Critères : ADJUST, CAPTURE, IMMUTABLE, DESIGN.

## Acteurs et droits

- Auteur possède Consulter, Déposer et Exporter dans le dossier dédié.

## Préconditions et préparation séparée

- Avant toute campagne : déploiement Dev et commit réellement observés, QA technique établie, cette version admise et sélection exacte autorisée. Une proposition ne vaut ni admission ni exécution.
- Comptes synthétiques déjà autorisés et sessions privées disponibles ; fixtures exclusives préfixées BU-CAP-<campagne>-<fiche>, inventaire UI initial et noms attendus consignés sans secrets. Pas de données familiales, création de compte, courriel ou changement de rôle implicite.
- Actions et assertions métier exclusivement dans l’UI avec les API documentées de Browser Use. Aucun SQL, appel API Hestia, état interne ou interception réseau. Les étapes décrivent le comportement validé, sans concevoir une interface.
- Brouillon préparé séparément, origine documentée et pages visuellement distinctes. Aucun fichier injecté ne sera présenté comme une prise de vue réelle.

## Données synthétiques

- Brouillon caméra de trois pages synthétiques confirmées, avec repères A, B, C distincts et bordures de recadrage ; dossier vide et titre unique.

## Actions UI

- Reprendre le brouillon ; déplacer B avant A ; tourner B ; recadrer A avec les contrôles UI ; retirer C.
- Fermer puis reprendre le même brouillon, vérifier l’ordre B/A et les ajustements persistants. Continuer.
- Observer le format PDF multipage, saisir le titre, parcourir vers le dossier autorisé, vérifier les accès et confirmer une seule fois.
- Ouvrir le document puis télécharger le PDF via l’UI ; examiner les deux pages avec un visualiseur local autorisé et rapprocher les repères et recadrages des aperçus.

## Assertions attendues

- Deux pages B puis A subsistent après reprise ; C est absente. Rotation et recadrage correspondent aux choix visibles.
- Plusieurs pages produisent un PDF ; aucune option Image ne prétend représenter l’ensemble multipage.
- Le PDF téléchargé contient exactement B puis A, avec rotation/recadrage validés et sans C ; un document final unique persiste.
- Aucune analyse n’est nécessaire pour classer manuellement.

## Effets persistants

- Un document PDF synthétique durable, un brouillon finalisé et des temporaires à purger.

## Remise en état

- Conserver les seules fixtures de cette fiche et leur état final dans le rapport ; aucune purge irréversible ni reset global. Les temporaires suivent le cycle normal du produit ; leur disparition de l’UI ne prouve pas un effacement physique.

## Arrêt

- Prérequis manquant, cible inconnue, outil incapable de réaliser un geste ou donnée non synthétique : bloquer avant ce geste ; ne pas remplacer une assertion par une preuve technique.
- Session invalide, dérive de déploiement, contamination ou mutation incertaine : arrêter la campagne et réconcilier avant toute nouvelle sélection. Ne jamais rejouer aveuglément une finalisation.
- Assertion visible contredite : constater FAIL sans affaiblir la fiche ni réparer le produit dans la tentative. Aucun résultat actuel n’est repris d’un ancien PASS.

## Limites de preuve

- Reprendre une prise de vue exige un appareil réel et relève du complément manuel distinct ; aucune preuve d’acquisition native dans cette fiche.
