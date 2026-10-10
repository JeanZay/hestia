```json
{
  "schemaVersion": 1,
  "revision": 1,
  "status": "active",
  "theme": "Capture et classement",
  "actor": "Membres synthétiques autorisés, désignés par alias ; aucune création de compte dans la fiche",
  "references": [
    "artifacts/refinement/capture-classification-2026-10-10/execution-ready-v5/refinement.json",
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
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-10T21:25:00.000Z",
    "proposalSha256": "718d12481150060566ffa8635058ce0be5ffed6663094f7e5bb48076ea9e9de7",
    "decisionSha256": "6ba351b5356888ee19cb1537d88b70728fb7b58e810a33eaee003762f39c9b7e",
    "contentSha256": "4ab8143abfcbf716f89b4558c89cda3a5225822df191fb1402a87daff43534cd",
    "contractSha256": "569bb625ec9ab5d9deb35020603e5c3eea0c027dde375d53f239bdbaef07700b"
  }
}
```

# Ajuster des pages sauvegardées et produire le PDF retenu

Proposition v1 non approuvée, non admise et non exécutée (NOT_RUN).

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
