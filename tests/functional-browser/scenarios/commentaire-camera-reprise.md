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
    "Fichier synthetic.png du dépôt disponible via le sélecteur Browser Use ; dossier de campagne dédié déjà accessible.",
    "Profil mobile simulé permettant le sélecteur photo ; il ne prouve pas une caméra physique."
  ],
  "syntheticData": [
    "Image ou PDF synthétique du dépôt ; titres et texte explicitement fictifs."
  ],
  "persistentEffects": [
    "Préparation temporaire propre au compte synthétique ; aucun document familial."
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
  "id": "commentaire-camera-reprise",
  "title": "Reprendre un commentaire caméra sauvegardé",
  "objective": "Le texte confirmé suit le brouillon caméra sans déplacer son échéance, puis disparaît avec la préparation.",
  "actions": [
    "Depuis Photo, fournir une image synthétique via Prendre la première page.",
    "Donner un titre unique, atteindre Rangement, saisir un commentaire synthétique et attendre explicitement Commentaire enregistré dans le brouillon.",
    "Noter l’échéance visible du brouillon, fermer la préparation et recharger Hestia.",
    "Depuis Moi puis Brouillons, reprendre le brouillon de même titre et retourner à Rangement.",
    "Vérifier le commentaire repris, fermer et abandonner ce seul brouillon dans l’interface."
  ],
  "assertions": [
    "Le commentaire confirmé est repris à l’identique.",
    "L’échéance visible reste celle du brouillon initial ; aucune prolongation liée à la saisie n’est annoncée.",
    "Après abandon confirmé, ce brouillon ne figure plus dans la liste.",
    "Les durées exactes et purges internes restent des preuves techniques séparées, pas déduites de cette observation UI."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-14T20:02:51.000Z",
    "proposalSha256": "57b0712f4c219b4bfb6f90caf884dd17317ed4c0adb8be845a078fbda27dccc7",
    "decisionSha256": "28f5adfcbd8a4c1fef1305c8da9332ccf6fd04133d279d9ba742d51515f65e3e",
    "contentSha256": "5de03211d9b640e45e7179a3a9804cfebcf702aa18961eca28c94b9e106385b1",
    "contractSha256": "80d8d4a1dc66fe2ba7b971e1b93737b5707d3417a1378b4c20c3faf3d0cad266"
  }
}
```

# Reprendre un commentaire caméra sauvegardé

Proposition v1 non admise, non exécutée.

Le texte confirmé suit le brouillon caméra sans déplacer son échéance, puis disparaît avec la préparation.

## Actions UI

1. Depuis Photo, fournir une image synthétique via Prendre la première page.
2. Donner un titre unique, atteindre Rangement, saisir un commentaire synthétique et attendre explicitement Commentaire enregistré dans le brouillon.
3. Noter l’échéance visible du brouillon, fermer la préparation et recharger Hestia.
4. Depuis Moi puis Brouillons, reprendre le brouillon de même titre et retourner à Rangement.
5. Vérifier le commentaire repris, fermer et abandonner ce seul brouillon dans l’interface.

## Résultats attendus

- Le commentaire confirmé est repris à l’identique.
- L’échéance visible reste celle du brouillon initial ; aucune prolongation liée à la saisie n’est annoncée.
- Après abandon confirmé, ce brouillon ne figure plus dans la liste.
- Les durées exactes et purges internes restent des preuves techniques séparées, pas déduites de cette observation UI.

Préconditions, effets, remise en état et arrêts : métadonnées ci-dessus. Aucun appel API, interception ni preuve Playwright ne remplace une assertion Browser Use.
