# Fondation Hestia — bilan du 12 septembre 2026

**Fondation livrée localement et vérifiée.** Le résultat est une démo synthétique, une documentation fondatrice et un harnais de contribution. Il ne constitue pas encore le service familial cible. Aucun dépôt distant, aucune publication, aucun service payant et aucun déploiement distant n'ont été créés.

## Livré localement

- Audit initial : dépôt vide, branche `main` sans commit, aucun remote ni fichier de travail à préserver. Fondation réalisée directement dans le dossier autorisé ; branche locale `codex/foundation` préparée pour sa conservation.
- Spécification anonymisée : 61 décisions, 8 options et 7 questions ouvertes, avec carte de couverture du carnet. La frontière entre produit public et outils privés de communication est conservée ; aucun outil de cette usine privée n'est inclus.
- README français, architecture cible, sécurité, portabilité et ADR réversible : Next.js/TypeScript, PostgreSQL et objets compatibles S3. Markdown pour le contexte, CSV réservé aux échanges.
- Démo adaptée au téléphone : quatre documents initiaux, cinquième exemple chargeable, recherche et filtres, source et empreinte des originaux, validation/refus d'une date ambiguë, connecteurs simulés et coupe-circuit initialement actif. Les choix s'effacent au rechargement ; aucun fichier personnel n'est accepté.
- AGENTS, CLAUDE, skill de livraison, contrats et modèles de preuves ; guard et hooks Git fournis et testés. Leur activation persistante dans le clone reste volontaire : aucune configuration globale n'est changée. Les hooks ne remplacent pas les protections GitHub futures.
- Application locale Node et image Docker autonome utilisables ; la démo Docker est laissée accessible sur [cet ordinateur](http://127.0.0.1:3000). Arrêt avec `docker compose down`. Aucun accès depuis le réseau local n'est publié.

## Preuves du candidat

Candidat relu et testé : **68 fichiers**, empreinte SHA-256 de la liste canonique des chemins et empreintes :

`9801700e9542fbafbb97639d544b6cd6241d489d32e8362fabe3e7163ceea124`

Le [manifeste conservé](reviews/foundation-candidate.json) et la [revue indépendante complète](reviews/foundation-review.md) identifient ce candidat et l'historique des vérifications. Seuls ce bilan et les deux fichiers de compte rendu `docs/reviews/foundation-*` sont ajoutés après le gel ; ils sont explicitement exclus des 68 fichiers relus. Une comparaison des octets vérifie que le candidat n'a pas changé. Ces rapports ne sont ni une seconde liste de tâches ni une attestation de livraison distante.

| Contrôle réellement exécuté | Résultat |
| --- | --- |
| Installation propre Windows, Node 24.15.0 / npm 11 | `npm ci --ignore-scripts --offline` : code 0 |
| Installation propre Linux dans Docker | `npm ci --ignore-scripts` : code 0 |
| Gate complet Windows, démarré à 12:46:31 UTC | Guard, lint, types, tests, build et navigateur : 7 étapes, tous codes 0 |
| Harnais | 18 tests réussis, aucun sauté |
| Métier et intégrité des originaux | 20 tests réussis, aucun sauté |
| Navigateurs | 12 parcours réussis : Chromium ordinateur et émulation mobile ; arrêt du serveur confirmé par code 0 |
| Inspection visuelle | Six captures : coffre, validation, connecteurs sur ordinateur et mobile ; aucun débordement observé |
| Dépendances du candidat final | Audit npm : 0 vulnérabilité signalée, code 0 |
| Docker final | Reconstruction, démarrage sain, health HTTP 200 et original synthétique HTTP 200 vérifiés à 12:48:56 UTC |
| Revue indépendante | PASS final, contexte neuf, relecteur distinct des auteurs ; aucun constat ouvert |

**Total : 50 tests réussis.** Les sorties locales détaillées restent dans `artifacts/verification.json`, `artifacts/dependency-audit.json`, `artifacts/docker-verification.json` et `playwright-report/`, ignorés par Git. La CI préparée pourra conserver ses propres résultats en artifacts GitHub après publication autorisée.

La revue a détecté puis fait corriger un risque de faux succès du runner navigateur : port déjà occupé ou mort du serveur possédé. La correction a été reproduite indépendamment et dispose de tests dédiés. Le réseau Docker de l'application a aussi été ajusté après vérification de l'accès réel depuis l'hôte. Les erreurs intermédiaires ne sont pas comptées comme des réussites.

L'image Linux finale correspond au manifeste `sha256:9e7ac44776ac1a2983b4c0608b5b351622d6cd6944c19fb44e903e4fc97165af`. Le réseau applicatif bridge rend le port loopback accessible ; il n'est pas un pare-feu de sortie. Le PostgreSQL optionnel est sur un réseau interne séparé, sans port hôte ni volume durable.

## Proposé pour GitHub

Douze propositions d'issues sont prêtes dans `harness/github-issue-proposals.json`, avec besoins, critères et dépendances. Aucun statut vivant n'est entretenu dans ce fichier ; après import autorisé, GitHub Issues et Projects seront l'unique backlog. Modèles d'issues/PR et CI Windows/Linux/Docker sont préparés. Aucune CI distante ni protection de branche n'a encore été activée ou vérifiée.

Le [choix de licence](licensing.md) recommande Apache-2.0, en présentant MIT et AGPL-3.0. Aucun fichier LICENSE n'accorde de droits ; les métadonnées restent `private: true` et `UNLICENSED` jusqu'à la décision explicite.

## Bloqué ou différé

Aucun obstacle technique ne bloque la remise de cette fondation locale. Licence et publication restent en attente d'une décision d'Amaury.

Sont différés : authentification et droits réels, persistance SQL/S3, ingestion fichier/photo, OCR/IA, déduplication réelle, profil familial, recherche sémantique, connecteurs externes, export intégral et sauvegardes/restaurations. Le profil PostgreSQL Compose est fourni mais n'a pas été lancé ni intégré ; aucune garantie de stockage n'est acquise. La qualification iOS/Safari réelle, l'accessibilité exhaustive, Dev et Production restent à réaliser.

Limite d'outillage connue : ESLint 9.39.5 est signalé non maintenu par npm, mais reste requis par les plugins Next.js installés ; l'essai d'ESLint 10 casse cette compatibilité. L'ADR conserve cette réserve. L'audit sans alerte ne vaut pas garantie générale de sécurité. Aucun appel ni contre-revue Claude n'a été effectué ; le PASS rapporté est celui de la revue Codex indépendante.

## Décisions nécessaires

1. Choisir la licence, avec Apache-2.0 comme proposition.
2. Autoriser ou différer la création et la publication du dépôt GitHub public.

Ces deux décisions ne valent ni achat d'hébergement, ni autorisation de données réelles, ni GO Production. La future recette se fera sur Dev ; la promotion en Production exigera un GO explicite sur la version exacte.
