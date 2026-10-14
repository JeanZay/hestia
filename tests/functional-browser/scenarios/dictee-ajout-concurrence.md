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
    "Dictée réelle qualifiée et activée sur Dev ; coût synthétique couvert par l’autorisation de qualification.",
    "Browser Use peut fournir une entrée audio synthétique par une capacité documentée, sans substitution API ni accès à un document réel.",
    "Phrase synthétique préparée : « Il s’agit du véhicule fictif bleu, pas du rouge. »"
  ],
  "syntheticData": [
    "Image ou PDF synthétique du dépôt ; titres et texte explicitement fictifs."
  ],
  "persistentEffects": [
    "Deux appels STT synthétiques explicitement autorisés ; aucun audio durable attendu."
  ],
  "cleanup": [
    "Abandonner dans l’interface uniquement les brouillons de ce parcours si leur identité et état sont certains.",
    "Les documents synthétiques finalisés restent identifiés dans le rapport ; leur éventuel nettoyage suit la procédure dédiée."
  ],
  "stopConditions": [
    "Identité Dev, compte, autorisation ou données inconnus : bloquer.",
    "Résultat de mutation incertain : arrêter et réconcilier avant répétition.",
    "Une action ou assertion impossible dans Browser Use reste BLOCKED/NOT_RUN ; aucun résultat API/Playwright ne la remplace.",
    "Si l’outil ne peut pas fournir l’audio ou si la réponse arrive avant qu’une édition concurrente soit observable, marquer la partie concernée BLOCKED/NOT_RUN, sans faux PASS ni répétition payante automatique."
  ],
  "dependencies": [],
  "id": "dictee-ajout-concurrence",
  "title": "Dicter puis préserver une correction concurrente",
  "objective": "La dictée ajoute du texte après arrêt et met à part un résultat devenu concurrent.",
  "actions": [
    "À Rangement, saisir Préfixe synthétique puis Dicter la suite.",
    "Fournir la phrase synthétique, arrêter explicitement puis relire le texte ajouté après le préfixe et le corriger au clavier.",
    "Démarrer une seconde dictée synthétique. Après arrêt, modifier le commentaire pendant que Transcription en cours est effectivement visible.",
    "Au retour du résultat, lire le panneau Texte dicté, pas encore ajouté ; corriger son texte et utiliser Ajouter à la fin du commentaire.",
    "Vérifier le texte assemblé et abandonner le brouillon de ce parcours."
  ],
  "assertions": [
    "Aucun texte dicté n’apparaît avant arrêt ; le préfixe reste intact et le texte reçu est modifiable.",
    "Le clavier reste utilisable pendant la transcription.",
    "Une modification concurrente reste intacte et le résultat dicté est présenté séparément.",
    "Le lancement d’une nouvelle dictée est désactivé tant que le résultat en attente n’est pas ajouté ou écarté.",
    "L’ajout est explicite, en fin du commentaire ; aucune analyse de rangement ne démarre seule."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-14T20:02:51.000Z",
    "proposalSha256": "9d504683f264f7056607eeaf98f62880c9549e5d19f2f805d524006be28d4b11",
    "decisionSha256": "e707ea70d07ad1b50b2cf1f9b5936e60a6a62550412e7824efe0e86e2d8c027e",
    "contentSha256": "3a66a0d60db9aff4f23370c65db61ae5b7f1ec873f91df1bd9392833a0df442f",
    "contractSha256": "8f6a87b67e1e7e7fb42946ce4bca3d1f1ed213fee5579a44107e2454632b84fd"
  }
}
```

# Dicter puis préserver une correction concurrente

Proposition v1 non admise, non exécutée.

La dictée ajoute du texte après arrêt et met à part un résultat devenu concurrent.

## Actions UI

1. À Rangement, saisir Préfixe synthétique puis Dicter la suite.
2. Fournir la phrase synthétique, arrêter explicitement puis relire le texte ajouté après le préfixe et le corriger au clavier.
3. Démarrer une seconde dictée synthétique. Après arrêt, modifier le commentaire pendant que Transcription en cours est effectivement visible.
4. Au retour du résultat, lire le panneau Texte dicté, pas encore ajouté ; corriger son texte et utiliser Ajouter à la fin du commentaire.
5. Vérifier le texte assemblé et abandonner le brouillon de ce parcours.

## Résultats attendus

- Aucun texte dicté n’apparaît avant arrêt ; le préfixe reste intact et le texte reçu est modifiable.
- Le clavier reste utilisable pendant la transcription.
- Une modification concurrente reste intacte et le résultat dicté est présenté séparément.
- Le lancement d’une nouvelle dictée est désactivé tant que le résultat en attente n’est pas ajouté ou écarté.
- L’ajout est explicite, en fin du commentaire ; aucune analyse de rangement ne démarre seule.

Préconditions, effets, remise en état et arrêts : métadonnées ci-dessus. Aucun appel API, interception ni preuve Playwright ne remplace une assertion Browser Use.
