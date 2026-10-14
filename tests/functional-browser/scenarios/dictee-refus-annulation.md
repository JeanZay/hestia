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
    "Dictée disponible et permissions microphone pilotables par les capacités documentées du navigateur.",
    "Entrée audio synthétique disponible pour la deuxième partie ; aucune voix privée."
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
  "id": "dictee-refus-annulation",
  "title": "Conserver le clavier après refus ou annulation de dictée",
  "objective": "Les sorties de dictée protègent le texte et arrêtent l’écoute.",
  "actions": [
    "Saisir un commentaire synthétique. Cliquer Dicter la suite puis refuser la permission dans le navigateur.",
    "Vérifier le message de refus et modifier le commentaire au clavier.",
    "Si les permissions peuvent être rétablies, autoriser le microphone puis démarrer une dictée synthétique.",
    "Annuler avant Arrêter et transcrire ; observer l’arrêt de l’état d’écoute et la conservation du commentaire.",
    "Démarrer une autre dictée synthétique puis quitter la préparation pendant l’écoute."
  ],
  "assertions": [
    "Le refus est expliqué ; le texte n’est pas perdu et le clavier reste disponible.",
    "Annuler avant émission indique que rien n’a été envoyé ; l’écoute s’arrête.",
    "Quitter la préparation supprime le contrôle actif ; aucune réponse ne s’insère dans un autre document.",
    "La libération technique des pistes et l’absence d’appel sont couvertes par les tests séparés ; l’indicateur navigateur est observé lorsqu’il est disponible."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-14T20:02:51.000Z",
    "proposalSha256": "6c15da3e889f7005ad31c1741e0d89bed8427f7cc86fd8a20f810cf2be082b69",
    "decisionSha256": "9c7ad2e6114bd6bcbd59654c067e347d4004e560937b6878fa68dd5079897549",
    "contentSha256": "da53fd4d52cbb9800575fde992573db87809a19888be7694e0d46e5e4987c25a",
    "contractSha256": "0f3e17c902ff4367a29ae19caefff8c99d4fcd4ba6d8453ef51ecacc41a4b840"
  }
}
```

# Conserver le clavier après refus ou annulation de dictée

Proposition v1 non admise, non exécutée.

Les sorties de dictée protègent le texte et arrêtent l’écoute.

## Actions UI

1. Saisir un commentaire synthétique. Cliquer Dicter la suite puis refuser la permission dans le navigateur.
2. Vérifier le message de refus et modifier le commentaire au clavier.
3. Si les permissions peuvent être rétablies, autoriser le microphone puis démarrer une dictée synthétique.
4. Annuler avant Arrêter et transcrire ; observer l’arrêt de l’état d’écoute et la conservation du commentaire.
5. Démarrer une autre dictée synthétique puis quitter la préparation pendant l’écoute.

## Résultats attendus

- Le refus est expliqué ; le texte n’est pas perdu et le clavier reste disponible.
- Annuler avant émission indique que rien n’a été envoyé ; l’écoute s’arrête.
- Quitter la préparation supprime le contrôle actif ; aucune réponse ne s’insère dans un autre document.
- La libération technique des pistes et l’absence d’appel sont couvertes par les tests séparés ; l’indicateur navigateur est observé lorsqu’il est disponible.

Préconditions, effets, remise en état et arrêts : métadonnées ci-dessus. Aucun appel API, interception ni preuve Playwright ne remplace une assertion Browser Use.
