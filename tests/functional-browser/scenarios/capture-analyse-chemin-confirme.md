```json
{
  "schemaVersion": 1,
  "revision": 3,
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
    "NOT_RUN : fournisseur/modèle réel non qualifié et désactivé à la préparation du 10 octobre 2026. Qualification synthétique, activation Dev, clé privée, plafond, coût et transfert externe exigent des preuves et autorisations distinctes avant toute exécution.",
    "La préparation qualifiée doit établir un corpus donnant plusieurs suggestions existantes justifiées et un chemin nouveau sous le parent autorisé. Si ces résultats ne sont pas disponibles, la fiche ne peut pas être PASS et ses assertions ne sont pas supprimées."
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
  "id": "capture-analyse-chemin-confirme",
  "title": "Choisir une suggestion puis confirmer un nouveau chemin sans automatisme",
  "objective": "Choisir une suggestion puis confirmer un nouveau chemin sans automatisme",
  "rights": [
    "Auteur possède Consulter et Déposer dans deux dossiers existants suggérables ; il possède Consulter, Déposer et Modifier sur le parent de création autorisé. Aucun autre accès donné au fournisseur."
  ],
  "syntheticData": [
    "Nouveau document synthétique avec repères lisibles, deux dossiers autorisés et un parent isolé ; dossier privé tiers au nom témoin jamais accessible à Auteur ; sous-chemin nouveau absent au départ."
  ],
  "actions": [
    "Importer le document synthétique puis ouvrir le choix de destination sans déclencher d’analyse ; observer l’état manuel initial.",
    "Déclencher une seule analyse par le bouton du document et attendre le résultat visible sans répétition facturable automatique.",
    "Observer l’ordre des destinations, les justifications des dossiers existants et le chemin complet nouveau ; sélectionner le chemin nouveau sans encore confirmer.",
    "Dans le même écran Capture, ouvrir Parcourir les dossiers pour vérifier que le chemin sélectionné n’existe pas avant confirmation, puis revenir aux suggestions déjà obtenues, sélectionner le même chemin et ouvrir sa vérification des accès. Ne pas fermer Capture, quitter vers la navigation générale, abandonner l’import ou relancer l’analyse : le même import et l’unique analyse sont conservés.",
    "Confirmer explicitement une seule fois la création du chemin et le classement ; recharger, ouvrir le chemin complet et son document."
  ],
  "assertions": [
    "Le parcours manuel est disponible avant analyse ; aucun classement ni création n’est effectué à réception des suggestions.",
    "Ordre visible : parcourir, dossier courant s’il reste autorisé, dossiers existants justifiés, nouveaux chemins complets. Aucun dossier privé tiers n’est révélé.",
    "Avant confirmation le nouveau chemin est absent ; après confirmation un seul chemin complet et un seul document sont présents.",
    "La confirmation expose les accès dans l’enveloppe autorisée ; l’IA n’ajoute aucun droit documentaire."
  ],
  "persistentEffects": [
    "Une analyse externe facturable seulement après future autorisation, un chemin de dossiers hérités et un document synthétique durables."
  ],
  "approval": {
    "kind": "editorial",
    "actor": "haiku_candidate_review",
    "approvedAt": "2026-10-10T22:50:12.473Z",
    "proposalSha256": "0e4172abda3006a28668aabdc56ed5338f8985d500b116694f3da2c369cdd691",
    "decisionSha256": "9d7ccf32984e1b7d063367546faf29d4560c025e3a9932eca40a6f4783d4e3fa",
    "contentSha256": "58630edd4fd37cf952572e0d6d5e47d1befd128998328e7b2ee7d248c3f0661d",
    "contractSha256": "2d3cd3c73170dbae42c4a7fd3301b33fbbc4ef4b02a5670678bf48c5a46f448e"
  }
}
```

# Choisir une suggestion puis confirmer un nouveau chemin sans automatisme

Fiche admise ; révision éditoriale des références publiques. Aucun parcours exécuté ni résultat antérieur repris (NOT_RUN).

Critères : ANALYZE, DESTINATION, RIGHTS, ADJUST.

## Acteurs et droits

- Auteur possède Consulter et Déposer dans deux dossiers existants suggérables ; il possède Consulter, Déposer et Modifier sur le parent de création autorisé. Aucun autre accès donné au fournisseur.

## Préconditions et préparation séparée

- Avant toute campagne : déploiement Dev et commit réellement observés, QA technique établie, cette version admise et sélection exacte autorisée. Une proposition ne vaut ni admission ni exécution.
- Comptes synthétiques déjà autorisés et sessions privées disponibles ; fixtures exclusives préfixées BU-CAP-<campagne>-<fiche>, inventaire UI initial et noms attendus consignés sans secrets. Pas de données familiales, création de compte, courriel ou changement de rôle implicite.
- Actions et assertions métier exclusivement dans l’UI avec les API documentées de Browser Use. Aucun SQL, appel API Hestia, état interne ou interception réseau. Les étapes décrivent le comportement validé, sans concevoir une interface.
- NOT_RUN : fournisseur/modèle réel non qualifié et désactivé à la préparation du 10 octobre 2026. Qualification synthétique, activation Dev, clé privée, plafond, coût et transfert externe exigent des preuves et autorisations distinctes avant toute exécution.
- La préparation qualifiée doit établir un corpus donnant plusieurs suggestions existantes justifiées et un chemin nouveau sous le parent autorisé. Si ces résultats ne sont pas disponibles, la fiche ne peut pas être PASS et ses assertions ne sont pas supprimées.

## Données synthétiques

- Nouveau document synthétique avec repères lisibles, deux dossiers autorisés et un parent isolé ; dossier privé tiers au nom témoin jamais accessible à Auteur ; sous-chemin nouveau absent au départ.

## Actions UI

- Importer le document synthétique puis ouvrir le choix de destination sans déclencher d’analyse ; observer l’état manuel initial.
- Déclencher une seule analyse par le bouton du document et attendre le résultat visible sans répétition facturable automatique.
- Observer l’ordre des destinations, les justifications des dossiers existants et le chemin complet nouveau ; sélectionner le chemin nouveau sans encore confirmer.
- Dans le même écran Capture, ouvrir Parcourir les dossiers pour vérifier que le chemin sélectionné n’existe pas avant confirmation, puis revenir aux suggestions déjà obtenues, sélectionner le même chemin et ouvrir sa vérification des accès. Ne pas fermer Capture, quitter vers la navigation générale, abandonner l’import ou relancer l’analyse : le même import et l’unique analyse sont conservés.
- Confirmer explicitement une seule fois la création du chemin et le classement ; recharger, ouvrir le chemin complet et son document.

## Assertions attendues

- Le parcours manuel est disponible avant analyse ; aucun classement ni création n’est effectué à réception des suggestions.
- Ordre visible : parcourir, dossier courant s’il reste autorisé, dossiers existants justifiés, nouveaux chemins complets. Aucun dossier privé tiers n’est révélé.
- Avant confirmation le nouveau chemin est absent ; après confirmation un seul chemin complet et un seul document sont présents.
- La confirmation expose les accès dans l’enveloppe autorisée ; l’IA n’ajoute aucun droit documentaire.

## Effets persistants

- Une analyse externe facturable seulement après future autorisation, un chemin de dossiers hérités et un document synthétique durables.

## Remise en état

- Conserver les seules fixtures de cette fiche et leur état final dans le rapport ; aucune purge irréversible ni reset global. Les temporaires suivent le cycle normal du produit ; leur disparition de l’UI ne prouve pas un effacement physique.

## Arrêt

- Prérequis manquant, cible inconnue, outil incapable de réaliser un geste ou donnée non synthétique : bloquer avant ce geste ; ne pas remplacer une assertion par une preuve technique.
- Session invalide, dérive de déploiement, contamination ou mutation incertaine : arrêter la campagne et réconcilier avant toute nouvelle sélection. Ne jamais rejouer aveuglément une finalisation.
- Assertion visible contredite : constater FAIL sans affaiblir la fiche ni réparer le produit dans la tentative. Aucun résultat actuel n’est repris d’un ancien PASS.

## Limites de preuve

- Ni lecture de payload ni comptage de requêtes réseau dans Browser Use. Minimisation réelle et résistance à l’injection restent des preuves techniques distinctes. Pas de fournisseur simulé secrètement substitué à une analyse réelle.
