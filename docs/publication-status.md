# Publication du code Hestia — 12 septembre 2026

Amaury a explicitement autorisé l'adoption d'Apache License 2.0 et la publication du dépôt public Hestia, après la vérification du lot fondateur. Cette décision porte sur le code et les outils contributeurs ; elle n'autorise aucun déploiement applicatif, service payant ou accès à des données familiales.

## Références officielles

| Élément | Référence |
| --- | --- |
| Code public et branche par défaut | [JeanZay/hestia — main](https://github.com/JeanZay/hestia) |
| Licence | [Apache-2.0](../LICENSE), appliquée aux éléments originaux ; [notices tierces](third-party-notices.md) distinctes |
| Registre du travail | [GitHub Issues](https://github.com/JeanZay/hestia/issues) |
| Vue de pilotage | [Hestia — Développement](https://github.com/users/JeanZay/projects/3) |
| Preuve de publication et de réglages | [Issue de gouvernance #1](https://github.com/JeanZay/hestia/issues/1) |
| Contrôles distants | [GitHub Actions](https://github.com/JeanZay/hestia/actions) |
| Signalement privé | [GitHub Security Advisories](https://github.com/JeanZay/hestia/security/advisories/new) |

Le compte connecté a été identifié comme `JeanZay`, le nom `hestia` vérifié libre, puis le dépôt créé sur ce compte. Aucun autre dépôt ou compte n'est utilisé comme destination de publication. Le commit fondateur `2c0700ccd8acf4dd0dd1c970de23fcfc99914b52` est conservé dans l'historique, sans réécriture.

Les douze propositions ont été transformées en Issues réelles et reliées au Project. Le [reçu d'import figé](imports/github-foundation-2026-09-12.json) conserve seulement la correspondance des clés et URLs. Le fichier de propositions a été supprimé du contenu courant ; ses versions historiques restent dans Git. Les critères, dépendances, priorités et états se maintiennent exclusivement sur GitHub.

## Maîtrise des contributions

La cible de protection de `main` impose une PR, les contrôles CI requis et la résolution des conversations ; force push et suppression sont interdits. Les restrictions s'appliquent aussi au mainteneur. L'absence d'un second mainteneur ne doit pas rendre le dépôt inutilisable : zéro approbation GitHub humaine obligatoire, avec revue indépendante du candidat exigée par le harnais et documentée dans la PR. Les fusions utilisent squash ; aucune fusion automatique ni livraison applicative n'est activée.

Les réglages réellement activés et les résultats des contrôles du SHA publié doivent être vérifiés dans GitHub et consignés dans l'Issue #1. Ce document fixe les références et la décision ; il n'est pas une preuve qu'un contrôle distant a réussi. Une évolution des réglages doit conserver les raisons et preuves dans GitHub.

La CI utilise des runners standard d'un dépôt public, sans cache Actions ni upload d'artifacts persistants. Les commandes de test produisent des fichiers temporaires sur le runner ; les logs et le résumé de job gardent le résultat des contrôles. Aucun abonnement, achat, stockage additionnel, secret ou workflow de déploiement n'est configuré. [Règles de facturation GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Portée du produit publié

Le code reste une démo locale synthétique `0.1.0-dev.0`. La publication ne livre ni authentification, ni persistance SQL/S3, ni OCR/IA, ni sauvegarde familiale. Le profil PostgreSQL optionnel et les futurs services nécessitent leur qualification propre. Le [bilan fondateur](foundation-status.md) conserve les preuves initiales et leurs limites, notamment la compatibilité ESLint 9.

Dev et Production restent les seuls environnements applicatifs durables prévus. Aucun des deux n'est déployé par ce lot. Les outils privés d'animation, d'analyse d'activité ou de communication du projet restent extérieurs au dépôt, sans accès au coffre familial.
