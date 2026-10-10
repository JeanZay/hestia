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
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-10T21:25:00.000Z",
    "proposalSha256": "bf7078d8c9409a26ee27dc14ab9193118e811d258b8c4cd81243c00a7a4feee7",
    "decisionSha256": "2510b53f1a39f33098a833f00151baf4bf2b2efbb06d8ee59288b5e7ec7e5932",
    "contentSha256": "4c56a8ac423d884c6bba31bf7e2677a6de2f16a992f2b656cd6b7018921b1e16",
    "contractSha256": "9a92b2112c715e4d3706b07cc4da484b5a79c3579b392ca52e90ed208d3944ef"
  }
}
```

# Refuser un import final au-delà de 20 Mio sans document partiel

Proposition v1 non approuvée, non admise et non exécutée (NOT_RUN).

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
