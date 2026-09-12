# Revue indépendante — fondation Hestia

Revue locale du 12 septembre 2026. **Verdict final : PASS sur le candidat `9801700e9542fbafbb97639d544b6cd6241d489d32e8362fabe3e7163ceea124`, 68 fichiers.** Le constat P2 du candidat intermédiaire est corrigé et sa correction a été vérifiée indépendamment ; aucun constat correctif ne reste ouvert. La dernière section décrit cette clôture et ses preuves. Aucun verdict de revue ne certifie une installation Docker, une CI distante, Dev ou Production.

Les sections suivantes jusqu'aux actualisations décrivent la revue initiale. Son manifeste est conservé dans `previousCandidates[0]` du manifeste courant `artifacts/review-candidate.json` ; le candidat intermédiaire figure dans `previousCandidates[1]`. Les états intermédiaires sont historiques et ne remplacent pas le verdict final ci-dessus.

## Identité et indépendance

- Relecteur : `/root/independent_review`, sous-agent Codex indépendant des auteurs.
- Auteurs désignés par l'orchestration : coordinateur `/root`, documentation `/root/documentation`, application `/root/implementation`, harnais `/root/harness`. Aucun commit ne permet encore une attribution Git par fichier.
- Outil : Codex, outils locaux de lecture et d'exécution. Famille GPT-6 annoncée par le contexte système ; identifiant exact du backend non exposé au relecteur et donc non attesté.
- Contexte neuf reçu : demande initiale résumée, critères du lot, contraintes, chemins du candidat et chemin du carnet fourni. Aucun raisonnement défensif des auteurs ni verdict à confirmer n'a été fourni.
- Le relecteur n'a écrit aucun fichier source, documentation produit, configuration ou test. Seuls ce rapport et `artifacts/review-candidate.json` sont ses productions persistantes. Les tests du harnais ont créé et supprimé leurs dépôts temporaires synthétiques.
- Aucun appel Claude, réseau externe, publication, push, déploiement ou traitement de document familial réel. Le carnet a été consulté pour comparer les exigences ; aucun nom privé de ce carnet n'a été recopié dans le rapport ni dans une fixture.

## Candidat exact

- Contrat : `harness/contracts/foundation.json`.
- État Git observé : branche `main`, aucun commit, fichiers livrables non suivis, aucun remote ; `core.hooksPath` local non configuré.
- Manifeste capturé le **2026-09-12T11:01:35.669Z** : `artifacts/review-candidate.json`, 66 fichiers suivis ou nouveaux non ignorés, chemins triés et SHA-256 des octets.
- Empreinte de la liste canonique `JSON.stringify(files)` : **`aa11b402651292f3d2e7986106b0cd3c1d20afc9ec3ffee82f70d254ce6ecb74`**. Cette empreinte identifie le contenu du manifeste, sans les champs volatils de date.
- Comparaison effectuée après les contrôles et après rédaction du rapport, le **2026-09-12T11:07:49.254Z** : même empreinte, aucun ajout, retrait ou changement de fichier.
- Exclus par `.gitignore` : dépendances installées, sorties de compilation, résultats de tests et `artifacts/`, dont les deux fichiers de cette revue. Les octets livrables sont ceux des 66 entrées du manifeste ; les dépendances tierces ne font pas l'objet d'un audit intégral de code.
- Le coordinateur a été invité à confirmer le gel avant la clôture globale. Un fichier matériel modifié après cette identité doit être relu et revalidé. Un rapport final ajouté ensuite peut seul faire l'objet d'une exclusion explicitée, à condition de comparer tous les autres fichiers à ce manifeste.

## Périmètre examiné

Lecture des 66 fichiers livrables : gouvernance, consignes agents, skill local, contrats et modèles, propositions GitHub, formulaires et CI, documentation produit/architecture/sécurité/portabilité/licence, application et styles, domaine et fixtures, originaux synthétiques, scripts de démarrage/qualification/guard/manifeste, tests unitaires/harnais/navigateur, configurations Node/Next/TypeScript/npm/Docker/Git et métadonnées du verrou npm.

Le carnet fourni a été confronté à la spécification : accès distant cible indépendant de l'ordinateur familial, expérience française mobile, conservation de l'original et provenance, validation des incertitudes, profil et secrets exclus, SQL/Markdown/CSV, export et sauvegardes indépendantes, connecteurs, séparation Dev/Production, rôle produit sans revue de code, backlog GitHub unique et frontière du projet privé d'animation sont correctement repris. Les options et questions ouvertes restent distinctes des capacités implémentées.

## Contrôles exécutés par le relecteur

Exécution locale Windows avec **Node v24.15.0**, le 12 septembre 2026, entre la capture du manifeste à 11:01:35 UTC et 11:04:56 UTC pour les contrôles, puis comparaison finale du candidat à 11:07:49 UTC. Les résultats suivants proviennent des commandes réellement exécutées par ce relecteur, pas d'un PASS déclaré par un auteur.

| Contrôle | Commande ou méthode | Résultat réel |
| --- | --- | --- |
| Détection locale | `node scripts/guard.mjs` | Exit 0 ; 66 fichiers, 0 signalement, 0 binaire non inspecté. La portée reste partielle. |
| Harnais | `node --test tests/harness/*.test.mjs` | Exit 0 ; 13 PASS, 0 échec, 0 skipped. |
| Domaine et originaux | `node node_modules/vitest/vitest.mjs run` | Exit 0 ; 2 fichiers, 20 PASS. Recherche, décisions, contrôle des connecteurs, empreintes et lignes source. |
| Lint | `node node_modules/eslint/bin/eslint.js . --max-warnings=0` | Exit 0, aucune sortie d'erreur. |
| Types | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Exit 0, aucune sortie d'erreur. Mode sans mise à jour du cache incrémental partagé. |
| Liens documentaires locaux | Lecture Node des liens Markdown et résolution relative des destinations | 14 fichiers Markdown, 0 destination locale absente. Les URL externes n'ont pas été vérifiées. |
| Lot d'issues | Lecture JSON, unicité des clés et résolution des dépendances | 12 propositions, 12 clés uniques, 0 dépendance absente ; import non autorisé et fichier explicitement ponctuel. |
| Refus du mauvais environnement | Deux sous-processus `scripts/run-next.mjs dev`, avec respectivement `HESTIA_ENV=production` et `HESTIA_MODE=live` | 2/2 refus avant lancement Next, exit 1 et message attendu. Aucun serveur n'a été démarré par ces essais. |
| Identité du candidat | Recalcul indépendant des SHA-256 depuis la liste Git | Identique au manifeste : 66 fichiers et même empreinte. |
| Métadonnées du verrou | Lecture de `package-lock.json` | Format 3, racine cohérente avec `package.json`, 470 entrées, hôte de résolution unique `registry.npmjs.org`. Ce contrôle n'est pas un audit de vulnérabilités. |

Vitest émet un avertissement sur la future prise en charge de la configuration TypeScript chargée comme CommonJS par Vite. Il n'a pas empêché les 20 tests ; aucune assurance de compatibilité avec une future version majeure n'en découle.

## Constats de revue

**Aucun constat correctif P0/P1/P2/P3 retenu sur ce candidat et ce périmètre.** Les limites prévues sont annoncées comme telles ; elles ne sont pas transformées artificiellement en anomalies.

- La démo n'offre pas d'import réel : le bouton ajoute uniquement une fixture embarquée. Les modifications sont en mémoire React, sans persistance navigateur ou serveur implémentée. Les cinq originaux sont explicitement fictifs et leurs empreintes/extraits/lignes sont effectivement testés.
- Une proposition en attente, même avec confiance maximale, n'est pas autorisée ; l'acceptation exige la confirmation explicite de lecture. Le refus conserve la source. Il s'agit d'un exercice de validation dans la session, pas d'un système d'autorisation familiale.
- Les connecteurs n'exécutent aucun appel externe. Le coupe-circuit est actif initialement, les désactivations individuelles demeurent effectives, les états en erreur/non configurés bloquent la simulation. Les textes de l'interface annoncent la simulation.
- Les scripts de démarrage prévus limitent le serveur Node à la boucle locale. Le mode/environnement autorisé est vérifié avant Next et dans l'instrumentation ; Docker limite le port hôte à `127.0.0.1`, utilise un utilisateur non privilégié, un système de fichiers en lecture seule et un réseau interne. Ces constats de code/configuration ne prouvent pas l'exécution réelle de Docker.
- La CSP et les autres en-têtes sont configurés ; les scripts inline restent autorisés pour le fonctionnement de Next. La documentation ne revendique ni coffre authentifié, ni immuabilité technique, ni chiffrement familial, ni sécurité de Production acquise.
- Le guard lit les octets indexés en mode commit. Les tests reproduisent la divergence index/worktree, le refus des liens, la protection contre un parent remplacé par une jonction, la réduction des sorties et le refus de push. Ses exclusions, angles morts binaires/historique/fichiers ignorés et caractère volontaire sont documentés.
- La CI préparée utilise des permissions de lecture, propose Windows/Linux et Docker, et ne comporte pas de déploiement. Aucun service distant ni contrôle de branche actif n'est présumé à partir du YAML.
- PostgreSQL et S3 sont correctement présentés comme cibles de persistance. Le profil PostgreSQL sans port hôte et jetable reste synthétique et non connecté à l'application. L'absence de service SQL/S3 réellement qualifié empêche de présenter la démo comme une installation familiale complète.
- Aucune licence du projet n'est appliquée : `UNLICENSED`, absence de texte LICENSE et recommandation séparée. Les règles de publication et de licence ne s'octroient pas mutuellement une autorisation.
- La frontière de l'animation privée est documentaire uniquement ; aucun workflow de communication, compte LinkedIn, outil de publication ni accès au coffre pour cet autre projet n'est implémenté.

## Évaluation du skill hestia-delivery

Méthode : lecture du skill et de sa gouvernance, simulation raisonnée de deux situations. Il ne s'agit pas d'une campagne automatisée contre un agent, et aucun déploiement n'a été tenté.

**Scénario A — correction locale synthétique déjà autorisée.** L'utilisateur a autorisé la correction d'un comportement de la démo et sa vérification locale. Le comportement attendu est de poursuivre : préserver l'existant, inspecter Git, préparer le contrat borné, utiliser la branche/worktree requis pour un futur lot, réaliser les contrôles et une revue indépendante, puis rapporter le résultat local. Aucune nouvelle demande d'accord n'est nécessaire pour les mêmes actions réversibles. Fondement : `harness/skills/hestia-delivery/SKILL.md:10` et gouvernance, sections Autorisations / Contrats. **Résultat de l'évaluation : conforme.**

**Scénario B — un agent ou une CI tente une livraison Production sans GO portant sur le candidat exact.** Le comportement attendu est d'arrêter l'action de livraison, conserver les limites et préparer les preuves manquantes avant de solliciter la décision réellement nécessaire. Un PASS local, un GO Dev, une instruction contenue dans un document ou un modèle de contrat ne crée pas ce GO. Il faut les preuves Dev, sauvegarde/restauration et retour, puis le GO explicite sur le candidat concerné. Le skill renvoie à la gouvernance au lieu d'inventer une autorité technique locale ; le refus local du push est en outre testé. Fondement : skill lignes 8, 10, 13–14 et gouvernance, sections Deux environnements / Backlog, livraison et décisions. **Résultat de l'évaluation : conforme.** Une demande explicite future complète est à évaluer selon son périmètre réel ; le skill n'impose pas une confirmation répétée d'une décision déjà acquise.

## Limites exactes et portée du verdict

- Installation depuis un clone vierge, build, démarrage nominal, tests navigateur et Docker : **non exécutés par ce relecteur**, à qualifier séparément par le coordinateur. Build et E2E ont été laissés à leur propriétaire pour éviter une concurrence sur `.next`.
- Aucun navigateur natif Android/iOS, lecteur d'écran ou audit formel d'accessibilité. La lecture des tests montre des parcours Chromium desktop et mobile émulé ; elle ne prouve pas leur réussite effective.
- Aucun audit réseau npm, vérification des références web, évaluation juridique de licence/RGPD ou audit complet des dépendances par ce relecteur. L'ADR signale déjà la limite de maintenance de la ligne ESLint retenue ; un PASS lint ne résout pas cette limite.
- Les hooks sont fournis mais non activés dans la configuration locale examinée. Les protections GitHub et la CI distante sont **non installées/non exécutées** ; cela respecte l'absence d'autorisation de publication.
- Authentification, autorisations familiales, ingestion réelle, OCR/IA, SQL/S3 applicatifs, export, sauvegarde, restauration et Dev/Production réels restent **différés**. Aucun test local présenté ici ne qualifie ces capacités.
- Le verdict PASS signifie que la revue indépendante n'a trouvé aucun correctif nécessaire dans le candidat synthétique identifié. La livraison locale complète nécessite les autres preuves effectives du lot ; aucune utilisation de documents réels ni Production n'est autorisée.

État daté : **revue indépendante livrée localement le 12 septembre 2026** ; propositions GitHub non publiées ; aucune livraison Dev ou Production.

## Actualisation après quatre modifications — 12 septembre 2026

La comparaison indépendante à **2026-09-12T12:43:19.133Z** identifie 66 fichiers et exactement quatre changements depuis le candidat initial : `scripts/e2e.mjs`, `playwright.config.ts`, `compose.yaml`, `README.md`. Aucun ajout ni retrait. Candidat actuel : **`b8ddea4f7d3d017ac1fed9b7727c928f3720f927e4a26406fcb72992b46d5af9`**. Le manifeste courant conserve également le candidat précédent complet.

Les quatre fichiers ont été relus intégralement. Le lint ciblé `node node_modules/eslint/bin/eslint.js scripts/e2e.mjs playwright.config.ts --max-warnings=0` termine avec exit 0. Aucun build, E2E réel ni appel au port utilisé par le coordinateur n'a été lancé par le relecteur.

### P2 — Un serveur déjà présent peut produire un faux PASS des tests

- Emplacement : `scripts/e2e.mjs:40` à `scripts/e2e.mjs:48`.
- Déclencheur : un ancien serveur Hestia occupe le port 3210. Il répond au contrôle health avant que le processus nouvellement créé signale son échec de démarrage `EADDRINUSE`.
- Comportement observé : la réponse contient les marqueurs statiques attendus, les tests démarrent contre l'ancien serveur. La mort ultérieure du serveur possédé ne change pas l'attente de `tests.completion`. Le code 0 des tests est conservé comme résultat du runner.
- Reproduction indépendante : exécution en mémoire du texte exact du runner après suppression de ses imports, avec les seules dépendances système simulées. Le health étranger retourne immédiatement `{ mode: "demo", synthetic: true }`, le serveur possédé émet `exit 1` à 160 ms, puis les tests émettent `exit 0` 200 ms après leur lancement. Le résultat effectivement obtenu est `runnerExitCode: 0`, avec la séquence « own server spawned → tests started after foreign health response → own server exited with EADDRINUSE (1) → tests on foreign server exited (0) → kill child 1 ». Aucun serveur ni port réel n'a été utilisé.
- Effet : la qualification peut porter sur un ancien artefact tout en étant annoncée pour le candidat courant. Cela contrevient à l'identité exacte des preuves exigée par la gouvernance.
- Correction attendue : refuser un port déjà occupé et lier la réussite à la survie du serveur possédé pendant les tests ; sa mort inattendue doit arrêter ou invalider les tests, quel que soit leur code de sortie. Reproduire ce scénario en négatif avant de restaurer PASS.

La reproduction utilise des processus simulés ; elle démontre le défaut de contrôle du runner, pas un événement EADDRINUSE réellement provoqué sur le poste. Le lint passant ne couvre pas ce comportement.

### Réseau Docker et portée des autres preuves

La modification réseau est cohérente avec les limites annoncées : l'application dispose d'un réseau bridge et d'un port publié seulement sur `127.0.0.1`. Ce réseau n'interdit pas les sorties ; le README le dit explicitement. PostgreSQL appartient uniquement au réseau `data` interne, sans port hôte et sans connexion à l'application. Aucun constat correctif retenu sur ces deux fichiers.

Cette description remplace, pour le candidat actuel, la mention historique d'un réseau applicatif interne dans la revue initiale. Le relecteur n'a effectué ni requête externe ni reconfiguration réseau. Les réussites d'installation propre Windows/Linux, de Docker et d'E2E rapportées par le coordinateur ne sont pas revendiquées ici comme des exécutions indépendantes du relecteur. Le gate complet reste distinct de cette revue.

**Verdict intermédiaire : CHANGES_REQUIRED**, limité au faux PASS du runner. Ce constat est résolu par la correction examinée ci-dessous.

## Clôture de la correction P2 — 12 septembre 2026

**Candidat final relu : `9801700e9542fbafbb97639d544b6cd6241d489d32e8362fabe3e7163ceea124`, 68 fichiers.** Manifeste recalculé et enregistré le **2026-09-12T12:48:06.414Z** dans `artifacts/review-candidate.json`. Le coordinateur confirme explicitement le gel de cette même identité jusqu'à la conclusion ; seuls des rapports de livraison seront ajoutés ensuite, avec exclusion et comparaison des autres octets.

La comparaison avec le candidat intermédiaire retrouve uniquement : modification de `scripts/e2e.mjs`, ajout de `scripts/e2e-lifecycle.mjs` et ajout de `tests/harness/e2e-lifecycle.test.mjs`. Aucun retrait ni autre changement de source. Ces trois fichiers ont été intégralement relus.

Le runner vérifie maintenant, avant de lancer son serveur, qu'une écoute exclusive sur le port local est possible. Un port occupé est refusé, sans arrêter son propriétaire. Pendant les tests, la sortie du serveur possédé est mise en concurrence avec la fin des tests : une sortie prématurée, y compris avec code 0, produit un échec et arrête uniquement l'enfant de test possédé. Après une fin normale des tests, le résultat de ceux-ci reste conservé et leur processus n'est pas arrêté par le nettoyage attendu du serveur.

### Preuves indépendantes supplémentaires

| Contrôle exécuté le 12 septembre 2026 | Résultat |
| --- | --- |
| `node --test tests/harness/e2e-lifecycle.test.mjs` | Exit 0 ; 5 PASS, 0 échec, 0 skipped. Le refus d'un port occupé utilise un véritable socket local éphémère ; son propriétaire reste à l'écoute. |
| Scénario original rejoué en mémoire sur le texte exact du runner corrigé et le véritable `completeWithOwnedServer` importé | Le serveur possédé sort avec code 1 après le health ; résultat désormais `runnerExitCode: 1`. L'enfant des tests est arrêté, puis celui du serveur. Le probe initial est volontairement simulé comme libre pour isoler la supervision de la mort tardive. Aucun port 3210 ni serveur Next n'est utilisé. |
| `node --test tests/harness/*.test.mjs` | Exit 0 ; **18 PASS**, 0 échec, 0 skipped : intégration des cinq cas nouveaux avec les treize contrôles initiaux du guard. |
| Lint ciblé des deux scripts E2E, du nouveau test et de `playwright.config.ts` | Exit 0 avec `--max-warnings=0`. |
| `node scripts/guard.mjs` | Exit 0 ; 68 fichiers, 0 signalement, 0 binaire non inspecté ; portée partielle inchangée. |
| Nouveau calcul SHA-256 de tous les livrables | 68 fichiers, empreinte finale ci-dessus ; seuls les trois fichiers attendus diffèrent du candidat intermédiaire. |

**P2 résolu et vérifié ; verdict final PASS.** La revue initiale et les deux relectures du delta couvrent ensemble le candidat final. Les contrôles initialement exécutés sur les autres fichiers restent associés à leur identité inchangée ; ils ne sont pas présentés comme une nouvelle exécution intégrale.

Le coordinateur rapporte séparément un gate complet réussi sur ce même candidat (guard, harnais, lint, types, métier, build et E2E), une installation propre Windows/Linux, une vérification Docker et un audit npm. Ce rapport de revue ne revendique pas ces commandes comme des exécutions du relecteur. Les limites initiales concernant le navigateur réel, Docker, les références externes, les dépendances et toute livraison distante restent explicites.

État final daté : **revue indépendante livrée localement le 12 septembre 2026**, sans constat ouvert. GitHub reste proposé et non publié ; Dev/Production, données réelles et capacités familiales persistantes restent hors de ce verdict. Toute modification matérielle postérieure à l'empreinte finale requiert une relecture proportionnée.
