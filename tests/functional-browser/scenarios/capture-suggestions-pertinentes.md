```json
{
  "schemaVersion": 1,
  "id": "capture-suggestions-pertinentes",
  "revision": 1,
  "status": "active",
  "title": "Évaluer les suggestions de rangement sans imposer une création",
  "theme": "Capture — guide documentaire",
  "references": [
    "docs/adr/0009-capture-classification.md",
    "docs/adr/0010-openrouter-classification.md",
    "docs/design/capture-reference-root-integration.md",
    "docs/browser-recipe.md",
    "docs/design-governance.md",
    "https://github.com/JeanZay/hestia/issues/4"
  ],
  "actor": "Membre synthétique autorisé à déposer dans le dossier témoin ; aucune élévation de rôle.",
  "rights": [
    "Auteur possède Consulter, Déposer et Modifier sur le préfixe synthétique préparé ; aucun droit obtenu du guide ou du rôle de gestionnaire IA.",
    "L’aperçu des accès reste limité à ses droits : noms des personnes uniquement si autorisés, sinon capacités propres et indication neutre."
  ],
  "preconditions": [
    "Fiche exacte admise et campagne distinctement autorisée sur une cible Dev dont le déploiement et le commit sont réellement observés. QA technique applicable et navigateur disponible ; aucune reprise implicite des anciens PASS ou FAIL.",
    "Haiku 5.5 qualifié et activé ; transfert du document synthétique et des seuls dossiers autorisés, réglages anti-entraînement et budget applicables vérifiés. Un seul déclenchement d’analyse, aucune relance pour obtenir un chemin particulier.",
    "Compte et corpus synthétiques déjà autorisés. Inventaire UI initial du dossier témoin, de ses documents et sous-dossiers. Un dossier Équipements accessible constitue une destination pertinente pour la facture/garantie ; aucun nouveau compte ni changement de droits implicite.",
    "Le document et les catégories pertinentes sont figés avant analyse : facture et garantie de l’équipement fictif identifié, rangement équipement, achat ou garantie. Pas de noms de dossiers ou de profondeur imposés à Haiku ; pas d’instruction ajoutée au document pour forcer sa réponse.",
    "Toutes les actions métier et assertions de cette fiche sont UI. Ni réponse injectée, ni fournisseur simulé, ni appel API/SQL ne remplace le geste de l’utilisateur. Les preuves techniques de création sont distinctes et ne valent pas PASS Browser Use."
  ],
  "syntheticData": [
    "PNG synthétique facture/garantie de pompe à chaleur Aurore déjà qualifié, réutilisé sans modification ; son empreinte et sa provenance sont figées dans la préparation de campagne.",
    "Dossier témoin synthétique Équipements et son document durable, dans un préfixe de test connu ; inventaire initial conservé. Aucun document familial réel."
  ],
  "objective": "Vérifier que les destinations réellement affichées sont pertinentes pour le document et que le choix manuel reste possible, sans exiger une proposition de création. Cette fiche ne qualifie pas la création d’un suffixe.",
  "actions": [
    "Ouvrir dans l’UI le dossier témoin ; relever l’inventaire initial et les repères du document durable. Importer le PNG dont le contenu et l’empreinte ont été vérifiés séparément en préparation. Constater le champ Titre du document et la note indiquant que le fichier importé est conservé tel quel, puis ouvrir Choisir où ranger sans enregistrer. Aucun aperçu visuel du contenu importé n’est exigé dans Capture.",
    "Demander des suggestions une seule fois. Attendre le résultat terminal et relever séparément les dossiers existants et les nouveaux chemins affichés, ainsi que leurs justifications. Ne pas relancer ni modifier les propositions pour satisfaire le test.",
    "Évaluer chaque destination par rapport aux critères sémantiques figés. Une liste de nouveaux chemins vide est admise si au moins une destination pertinente est proposée ; elle ne prouve ni panne ni réussite de création.",
    "Utiliser Parcourir les dossiers et choisir manuellement le dossier témoin autorisé. Ouvrir Vérifier avant d’enregistrer ; constater le chemin et les accès affichés. Ne pas cliquer Enregistrer le document.",
    "Fermer cet import temporaire avec le contrôle Fermer. Revenir au dossier témoin, vérifier que son inventaire et le document durable sont préservés ; terminer la session de test."
  ],
  "assertions": [
    "Au moins une destination utile est proposée pour ce document non ambigu et ce catalogue préparé. Un résultat vide dans les deux listes ou une analyse en erreur est un FAIL distinct ; l’absence de création seule n’est pas un échec.",
    "Chaque destination affichée possède une justification positive étayée par le document. Aucun dossier sélectionnable justifié comme non pertinent ; aucun lien personnel ou logement inventé, placeholder non résolu ou accès non autorisé présenté.",
    "Zéro nouveau chemin est un résultat admissible. Si des nouveaux chemins sont affichés, ils satisfont les mêmes critères de pertinence ; aucun minimum de nombre, de profondeur ou nom exact n’est imposé.",
    "Le parcours manuel reste utilisable après le résultat IA ; l’aperçu correspond au dossier choisi et présente seulement les accès que le membre est autorisé à voir.",
    "Aucun document final ni sous-dossier supplémentaire n’apparaît dans le dossier témoin après fermeture sans confirmation ; le témoin durable et ses repères sont préservés. Cette observation bornée ne démontre pas l’absence globale d’écritures hors de ce dossier.",
    "Le rapport distingue explicitement verdict de pertinence et création NON EXERCÉE par cette fiche, même lorsqu’une proposition de création est affichée. Aucun ancien FAIL préfixe/suffixe n’est reclassé en PASS."
  ],
  "persistentEffects": [
    "Au plus une analyse facturée et les traces temporaires normales de l’import fermé. Aucun enregistrement final, création de dossier ou changement de droits dans cette fiche."
  ],
  "cleanup": [
    "Fermer uniquement l’import de cette tentative et la session ouverte pour la fiche ; préserver le document témoin, les autres brouillons et toutes les données durables.",
    "Les temporaires suivent leur cycle normal ; aucune purge globale dans la recette. Un nettoyage ultérieur demeure une opération séparée avec provenance et revue."
  ],
  "stopConditions": [
    "Prérequis absent, cible inconnue, fixture indisponible ou données non synthétiques : BLOCKED avant le geste concerné.",
    "Assertion visible contredite, résultat vide complet, analyse en erreur ou destination non pertinente : FAIL, sans relance ni correction de la fiche en cours de campagne.",
    "Session invalide, déploiement modifié, données contaminées ou mutation incertaine : arrêter et réconcilier avant toute suite ; ne pas rejouer automatiquement.",
    "Aucun mot de passe, cookie, lien signé ou contenu personnel dans les observations, fichiers ou captures."
  ],
  "dependencies": [],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-12T06:45:18.934Z",
    "proposalSha256": "f191b61002bc97f40e912eee02e51a162ea9ee7c72a1b4fa2a80cc281675ca70",
    "decisionSha256": "2e75b00f9507b2dc83cce35ce6f6283423dbfe86d69d64fce69a8c07648ee926",
    "contentSha256": "8c50693586ad8be6d9b1627326f1b4e844bbcf4bc57003c8d99ce764d9f521fd",
    "contractSha256": "d839d75fa5398892d65fb0cd0c82c0dd6073b40a854df698830368de103d9618"
  }
}
```

# Évaluer les suggestions de rangement sans imposer une création

PROPOSITION r1 — NON ADMISE — NOT_RUN. Aucun résultat ancien transféré.

Vérifier que les destinations réellement affichées sont pertinentes pour le document et que le choix manuel reste possible, sans exiger une proposition de création. Cette fiche ne qualifie pas la création d’un suffixe.

## Droits

- Auteur possède Consulter, Déposer et Modifier sur le préfixe synthétique préparé ; aucun droit obtenu du guide ou du rôle de gestionnaire IA.
- L’aperçu des accès reste limité à ses droits : noms des personnes uniquement si autorisés, sinon capacités propres et indication neutre.

## Prérequis

- Fiche exacte admise et campagne distinctement autorisée sur une cible Dev dont le déploiement et le commit sont réellement observés. QA technique applicable et navigateur disponible ; aucune reprise implicite des anciens PASS ou FAIL.
- Haiku 5.5 qualifié et activé ; transfert du document synthétique et des seuls dossiers autorisés, réglages anti-entraînement et budget applicables vérifiés. Un seul déclenchement d’analyse, aucune relance pour obtenir un chemin particulier.
- Compte et corpus synthétiques déjà autorisés. Inventaire UI initial du dossier témoin, de ses documents et sous-dossiers. Un dossier Équipements accessible constitue une destination pertinente pour la facture/garantie ; aucun nouveau compte ni changement de droits implicite.
- Le document et les catégories pertinentes sont figés avant analyse : facture et garantie de l’équipement fictif identifié, rangement équipement, achat ou garantie. Pas de noms de dossiers ou de profondeur imposés à Haiku ; pas d’instruction ajoutée au document pour forcer sa réponse.
- Toutes les actions métier et assertions de cette fiche sont UI. Ni réponse injectée, ni fournisseur simulé, ni appel API/SQL ne remplace le geste de l’utilisateur. Les preuves techniques de création sont distinctes et ne valent pas PASS Browser Use.

## Données synthétiques

- PNG synthétique facture/garantie de pompe à chaleur Aurore déjà qualifié, réutilisé sans modification ; son empreinte et sa provenance sont figées dans la préparation de campagne.
- Dossier témoin synthétique Équipements et son document durable, dans un préfixe de test connu ; inventaire initial conservé. Aucun document familial réel.

## Actions UI

- Ouvrir dans l’UI le dossier témoin ; relever l’inventaire initial et les repères du document durable. Importer le PNG dont le contenu et l’empreinte ont été vérifiés séparément en préparation. Constater le champ Titre du document et la note indiquant que le fichier importé est conservé tel quel, puis ouvrir Choisir où ranger sans enregistrer. Aucun aperçu visuel du contenu importé n’est exigé dans Capture.
- Demander des suggestions une seule fois. Attendre le résultat terminal et relever séparément les dossiers existants et les nouveaux chemins affichés, ainsi que leurs justifications. Ne pas relancer ni modifier les propositions pour satisfaire le test.
- Évaluer chaque destination par rapport aux critères sémantiques figés. Une liste de nouveaux chemins vide est admise si au moins une destination pertinente est proposée ; elle ne prouve ni panne ni réussite de création.
- Utiliser Parcourir les dossiers et choisir manuellement le dossier témoin autorisé. Ouvrir Vérifier avant d’enregistrer ; constater le chemin et les accès affichés. Ne pas cliquer Enregistrer le document.
- Fermer cet import temporaire avec le contrôle Fermer. Revenir au dossier témoin, vérifier que son inventaire et le document durable sont préservés ; terminer la session de test.

## Assertions

- Au moins une destination utile est proposée pour ce document non ambigu et ce catalogue préparé. Un résultat vide dans les deux listes ou une analyse en erreur est un FAIL distinct ; l’absence de création seule n’est pas un échec.
- Chaque destination affichée possède une justification positive étayée par le document. Aucun dossier sélectionnable justifié comme non pertinent ; aucun lien personnel ou logement inventé, placeholder non résolu ou accès non autorisé présenté.
- Zéro nouveau chemin est un résultat admissible. Si des nouveaux chemins sont affichés, ils satisfont les mêmes critères de pertinence ; aucun minimum de nombre, de profondeur ou nom exact n’est imposé.
- Le parcours manuel reste utilisable après le résultat IA ; l’aperçu correspond au dossier choisi et présente seulement les accès que le membre est autorisé à voir.
- Aucun document final ni sous-dossier supplémentaire n’apparaît dans le dossier témoin après fermeture sans confirmation ; le témoin durable et ses repères sont préservés. Cette observation bornée ne démontre pas l’absence globale d’écritures hors de ce dossier.
- Le rapport distingue explicitement verdict de pertinence et création NON EXERCÉE par cette fiche, même lorsqu’une proposition de création est affichée. Aucun ancien FAIL préfixe/suffixe n’est reclassé en PASS.

## Effets persistants

- Au plus une analyse facturée et les traces temporaires normales de l’import fermé. Aucun enregistrement final, création de dossier ou changement de droits dans cette fiche.

## Remise en état

- Fermer uniquement l’import de cette tentative et la session ouverte pour la fiche ; préserver le document témoin, les autres brouillons et toutes les données durables.
- Les temporaires suivent leur cycle normal ; aucune purge globale dans la recette. Un nettoyage ultérieur demeure une opération séparée avec provenance et revue.

## Conditions d’arrêt

- Prérequis absent, cible inconnue, fixture indisponible ou données non synthétiques : BLOCKED avant le geste concerné.
- Assertion visible contredite, résultat vide complet, analyse en erreur ou destination non pertinente : FAIL, sans relance ni correction de la fiche en cours de campagne.
- Session invalide, déploiement modifié, données contaminées ou mutation incertaine : arrêter et réconcilier avant toute suite ; ne pas rejouer automatiquement.
- Aucun mot de passe, cookie, lien signé ou contenu personnel dans les observations, fichiers ou captures.
