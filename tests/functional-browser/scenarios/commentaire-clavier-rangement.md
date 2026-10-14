```json
{
  "schemaVersion": 1,
  "revision": 1,
  "status": "active",
  "theme": "Commentaire et dictée",
  "references": [
    "docs/adr/0012-comment-transcription.md",
    "docs/design/comment-voice-integration.md",
    "tests/e2e/comment-voice.spec.ts"
  ],
  "actor": "Membre synthétique actif de recette Dev",
  "rights": [
    "Consultation et dépôt sur le seul dossier synthétique dédié."
  ],
  "preconditions": [
    "Déploiement Dev exact identifié et compte synthétique autorisé connecté.",
    "Fichier synthetic.png du dépôt disponible via le sélecteur Browser Use ; dossier de campagne dédié déjà accessible."
  ],
  "syntheticData": [
    "Image ou PDF synthétique du dépôt ; titres et texte explicitement fictifs."
  ],
  "persistentEffects": [
    "Un document synthétique est finalisé dans le dossier dédié ; la préparation disparaît."
  ],
  "cleanup": [
    "Abandonner dans l’interface uniquement les brouillons de ce parcours si leur identité et état sont certains.",
    "Les documents synthétiques finalisés restent identifiés dans le rapport ; leur éventuel nettoyage suit la procédure dédiée."
  ],
  "stopConditions": [
    "Identité Dev, compte, autorisation ou données inconnus : bloquer.",
    "Résultat de mutation incertain : arrêter et réconcilier avant répétition.",
    "Une action ou assertion impossible dans Browser Use reste BLOCKED/NOT_RUN ; aucun résultat API/Playwright ne la remplace."
  ],
  "dependencies": [],
  "id": "commentaire-clavier-rangement",
  "title": "Saisir un commentaire et conserver le rangement manuel",
  "objective": "Le commentaire est facultatif, éditable sans analyse automatique, borné sans troncature et ne supprime pas un choix manuel.",
  "actions": [
    "Importer le fichier synthétique, donner un titre unique, avancer à Rangement et sélectionner le dossier dédié manuellement.",
    "Saisir un commentaire synthétique puis modifier et corriger ce texte au clavier ; vérifier que le choix manuel reste indiqué.",
    "Coller un texte synthétique de 2001 caractères puis vérifier son affichage intégral et le message de dépassement. Ramener le texte à 2000 caractères.",
    "Préparer la confirmation, revenir à Rangement, modifier le commentaire puis demander un nouvel aperçu avant d’enregistrer.",
    "Enregistrer le document et ouvrir sa fiche depuis le dossier."
  ],
  "assertions": [
    "Aucune analyse n’est présentée comme lancée à la saisie ; le clavier reste utilisable.",
    "Le dépassement est signalé et les suggestions sont indisponibles jusqu’à correction ; aucun texte n’a été coupé.",
    "Le dossier choisi manuellement reste sélectionné et une nouvelle confirmation est présentée après modification.",
    "Le document enregistré possède son titre et son aperçu ; le commentaire ne devient pas une annotation de sa fiche."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-14T20:02:51.000Z",
    "proposalSha256": "dcf17dde65e2795bcaa5fae34a9144f2ad7e8c9ec5077eade96ffc73aca7b2c3",
    "decisionSha256": "f8bd65b2ec77a894cd973771e4901d01469884f81f1bfc96dc7c50e350357581",
    "contentSha256": "0e46c068b49934c2ae54abaa927b6d5dcb418f439424ed12b35eff617f3f2590",
    "contractSha256": "796ad600c6787edafb77bc08f49b22b72deded6e3ecca16f799c9c8acc206311"
  }
}
```

# Saisir un commentaire et conserver le rangement manuel

Proposition v1 non admise, non exécutée.

Le commentaire est facultatif, éditable sans analyse automatique, borné sans troncature et ne supprime pas un choix manuel.

## Actions UI

1. Importer le fichier synthétique, donner un titre unique, avancer à Rangement et sélectionner le dossier dédié manuellement.
2. Saisir un commentaire synthétique puis modifier et corriger ce texte au clavier ; vérifier que le choix manuel reste indiqué.
3. Coller un texte synthétique de 2001 caractères puis vérifier son affichage intégral et le message de dépassement. Ramener le texte à 2000 caractères.
4. Préparer la confirmation, revenir à Rangement, modifier le commentaire puis demander un nouvel aperçu avant d’enregistrer.
5. Enregistrer le document et ouvrir sa fiche depuis le dossier.

## Résultats attendus

- Aucune analyse n’est présentée comme lancée à la saisie ; le clavier reste utilisable.
- Le dépassement est signalé et les suggestions sont indisponibles jusqu’à correction ; aucun texte n’a été coupé.
- Le dossier choisi manuellement reste sélectionné et une nouvelle confirmation est présentée après modification.
- Le document enregistré possède son titre et son aperçu ; le commentaire ne devient pas une annotation de sa fiche.

Préconditions, effets, remise en état et arrêts : métadonnées ci-dessus. Aucun appel API, interception ni preuve Playwright ne remplace une assertion Browser Use.
