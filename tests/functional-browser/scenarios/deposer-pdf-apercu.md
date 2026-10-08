```json
{
  "schemaVersion": 1,
  "revision": 1,
  "status": "active",
  "references": [
    "tests/e2e/files.spec.ts",
    "docs/adr/0004-private-document-files.md"
  ],
  "actor": "Membre synthétique de recette Dev",
  "rights": [
    "Uniquement les capacités indiquées dans les prérequis de la fiche."
  ],
  "syntheticData": [
    "tests/fixtures/documents/synthetic.pdf uniquement ; dossier et titre synthétiques dédiés."
  ],
  "persistentEffects": [
    "Un original PDF synthétique et ses métadonnées sont ajoutés au dossier désigné."
  ],
  "cleanup": [
    "Conserver le document synthétique et son identification dans le rapport ; purge exclue du parcours."
  ],
  "stopConditions": [
    "Cible Dev ou version non établie : bloquer.",
    "Session, données ou résultat d’une mutation incertains : arrêter et réconcilier sans nouvelle tentative automatique."
  ],
  "dependencies": [],
  "id": "deposer-pdf-apercu",
  "title": "Déposer un PDF synthétique puis consulter son aperçu",
  "theme": "Documents",
  "preconditions": [
    "Compte synthétique connecté avec droits de dépôt et consultation sur un dossier dédié préexistant.",
    "PDF synthétique du dépôt disponible et sélecteur de fichier pris en charge par Browser Use.",
    "Titre unique prévu ; aucun document existant de même contenu dans ce dossier, sinon prérequis à réconcilier."
  ],
  "objective": "Vérifier le dépôt utilisateur d’un PDF et son aperçu dans l’interface.",
  "actions": [
    "Ouvrir le dossier puis Ajouter un document.",
    "Sélectionner le PDF synthétique dans le sélecteur de fichiers, renseigner le titre prévu puis Enregistrer.",
    "Attendre la confirmation visible, terminer l’ajout et ouvrir le document.",
    "Recharger le dossier et rouvrir le document."
  ],
  "assertions": [
    "La confirmation d’enregistrement est visible et le document apparaît sous le titre prévu.",
    "L’aperçu de la première page est visible lors des deux ouvertures.",
    "Une erreur n’est pas remplacée par un succès déduit d’une réponse API."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-08T07:04:11.584Z",
    "proposalSha256": "151943aeabf5cd6ad21cd9e61ec9c7b5eb247d8183e597d38e8f31a2ec1f5eba",
    "decisionSha256": "a86fc3d63afe75f208b56ebbe18b20cf1d1c565208449382597cb5ce5bf9ed35",
    "contentSha256": "92dc1678e2166a53c3fcb82cb2e51ed210d4f4e00ce4def14a65268d98cfcace",
    "contractSha256": "f123dbe758f3ba505df24cfbe82c41bacf958d5c9f87b832a57696832a275461"
  }
}
```

# Déposer un PDF synthétique puis consulter son aperçu

Proposition non approuvée, non exécutée.

## Situation et objectif

Vérifier le dépôt utilisateur d’un PDF et son aperçu dans l’interface.

## Actions dans l’interface

1. Ouvrir le dossier puis Ajouter un document.
2. Sélectionner le PDF synthétique dans le sélecteur de fichiers, renseigner le titre prévu puis Enregistrer.
3. Attendre la confirmation visible, terminer l’ajout et ouvrir le document.
4. Recharger le dossier et rouvrir le document.

## Résultats attendus

- La confirmation d’enregistrement est visible et le document apparaît sous le titre prévu.
- L’aperçu de la première page est visible lors des deux ouvertures.
- Une erreur n’est pas remplacée par un succès déduit d’une réponse API.

Préparations et effets : consulter les métadonnées structurées ci-dessus. Aucun accord d’exécution n’est déduit de cette proposition.
