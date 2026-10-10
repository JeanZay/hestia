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
    "Le PDF de dépassement est borné à 20 Mio plus une petite marge documentée et identifiable par le sélecteur UI ; aucun quota global ni service partagé ne sera modifié."
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
  "id": "capture-quota-refus",
  "title": "Refuser un import final au-delà de 20 Mio sans document partiel",
  "objective": "Refuser un import final au-delà de 20 Mio sans document partiel",
  "rights": [
    "Auteur possède Consulter et Déposer dans un dossier dédié vide."
  ],
  "syntheticData": [
    "Un PDF synthétique valide de taille strictement supérieure à 20 Mio, préparé et identifié avant campagne ; aucun document familial ou fichier massif non borné."
  ],
  "actions": [
    "Ouvrir Importer un fichier du parcours Capture et sélectionner le PDF de dépassement.",
    "Observer le refus ; si le formulaire reste accessible, ne pas contourner la validation ni changer le fichier pendant cette tentative.",
    "Revenir au dossier dédié, recharger et examiner la liste et les brouillons."
  ],
  "assertions": [
    "La limite de taille conduit à un refus visible ; aucune confirmation de document enregistré n’est affichée.",
    "Le dossier reste vide et aucun original durable partiel n’est présenté ; l’import refusé ne devient pas un brouillon caméra sept jours."
  ],
  "persistentEffects": [
    "Aucun document durable attendu ; toute copie temporaire éventuelle reste sous le nettoyage normal et le quota technique."
  ],
  "approval": {
    "kind": "editorial",
    "actor": "haiku_candidate_review",
    "approvedAt": "2026-10-10T22:50:13.841Z",
    "proposalSha256": "a69fbcfee5f5a5780a53151a51bfb69376654cbbfe0a14fd2e68dd2982b97522",
    "decisionSha256": "e5985f94d17d9fce54d8dc4791de067ffaa05040e61fcea04f64783f52c93f0b",
    "contentSha256": "2157d8201799337bb3d7e037e5ff96ae42fd2a86dc2e7a3726d5a196ef484221",
    "contractSha256": "3f707d9454a17a172e84ede44192e907dea9111273d46ed8c0cfbb81a4e51adf"
  }
}
```

# Refuser un import final au-delà de 20 Mio sans document partiel

Fiche admise ; révision éditoriale des références publiques. Aucun parcours exécuté ni résultat antérieur repris (NOT_RUN).

Critères : QUOTA, RETENTION, RETRY.

## Acteurs et droits

- Auteur possède Consulter et Déposer dans un dossier dédié vide.

## Préconditions et préparation séparée

- Avant toute campagne : déploiement Dev et commit réellement observés, QA technique établie, cette version admise et sélection exacte autorisée. Une proposition ne vaut ni admission ni exécution.
- Comptes synthétiques déjà autorisés et sessions privées disponibles ; fixtures exclusives préfixées BU-CAP-<campagne>-<fiche>, inventaire UI initial et noms attendus consignés sans secrets. Pas de données familiales, création de compte, courriel ou changement de rôle implicite.
- Actions et assertions métier exclusivement dans l’UI avec les API documentées de Browser Use. Aucun SQL, appel API Hestia, état interne ou interception réseau. Les étapes décrivent le comportement validé, sans concevoir une interface.
- Le PDF de dépassement est borné à 20 Mio plus une petite marge documentée et identifiable par le sélecteur UI ; aucun quota global ni service partagé ne sera modifié.

## Données synthétiques

- Un PDF synthétique valide de taille strictement supérieure à 20 Mio, préparé et identifié avant campagne ; aucun document familial ou fichier massif non borné.

## Actions UI

- Ouvrir Importer un fichier du parcours Capture et sélectionner le PDF de dépassement.
- Observer le refus ; si le formulaire reste accessible, ne pas contourner la validation ni changer le fichier pendant cette tentative.
- Revenir au dossier dédié, recharger et examiner la liste et les brouillons.

## Assertions attendues

- La limite de taille conduit à un refus visible ; aucune confirmation de document enregistré n’est affichée.
- Le dossier reste vide et aucun original durable partiel n’est présenté ; l’import refusé ne devient pas un brouillon caméra sept jours.

## Effets persistants

- Aucun document durable attendu ; toute copie temporaire éventuelle reste sous le nettoyage normal et le quota technique.

## Remise en état

- Conserver les seules fixtures de cette fiche et leur état final dans le rapport ; aucune purge irréversible ni reset global. Les temporaires suivent le cycle normal du produit ; leur disparition de l’UI ne prouve pas un effacement physique.

## Arrêt

- Prérequis manquant, cible inconnue, outil incapable de réaliser un geste ou donnée non synthétique : bloquer avant ce geste ; ne pas remplacer une assertion par une preuve technique.
- Session invalide, dérive de déploiement, contamination ou mutation incertaine : arrêter la campagne et réconcilier avant toute nouvelle sélection. Ne jamais rejouer aveuglément une finalisation.
- Assertion visible contredite : constater FAIL sans affaiblir la fiche ni réparer le produit dans la tentative. Aucun résultat actuel n’est repris d’un ancien PASS.

## Limites de preuve

- Les bornes exactes 20 Mio, réservations concurrentes, mémoire et libération après purge ne sont pas prouvées par cette seule observation UI.
