# Commandes locales de recette

Lire d'abord [la procédure](../../../../docs/browser-recipe.md). Les commandes ci-dessous gèrent fichiers et preuves ; elles n'appellent ni navigateur, ni API distante, ni LLM. Elles ne prouvent pas qu'un agent a réellement vu l'interface. Exécuter depuis le worktree du candidat ; `--root` permet de désigner explicitement un autre checkout du même clone. Les inputs sont des chemins relatifs à cette racine, jamais des secrets en argument.

## Catalogue et propositions

```text
node scripts/browser-recipe.mjs catalog list
node scripts/browser-recipe.mjs catalog check
node scripts/browser-recipe.mjs propose --input artifacts/proposition.md
node scripts/browser-recipe.mjs decision --input artifacts/decision.json
node scripts/browser-recipe.mjs promote --input artifacts/promotion.json
```

`audit` est l'alias de `catalog check` utilisé par la vérification. `catalog list --input artifacts/cible.json` peut recevoir un filtre `deployment` contenant environnement Dev, URL, identifiant de déploiement et commit. Sans filtre, la vue affiche l'historique, pas une qualification actuelle inventée.

Une fiche commence par un bloc délimité `json`, puis du Markdown. Les métadonnées sont régies par [le schéma de fiche](../../../../harness/schemas/browser-recipe-scenario.schema.json). Les données attendues sont reprises en prose pour la validation utilisateur. `propose` conserve une copie dans le stockage primaire et retourne l'identifiant de proposition et son empreinte ; il ne promeut rien.

La décision suit [le schéma de décision](../../../../harness/schemas/browser-recipe-decision.schema.json) : proposition/empreinte exactes, verdict, décision humaine ou correction éditoriale, auteur, acteur de la décision, date, source et citation minimisée. Les références portent chemin et empreinte. Une correction éditoriale référence en plus le diff et la revue indépendante. Consulter la source réelle avant de fabriquer le reçu : un JSON correctement rempli ne remplace pas l'accord.

L'input de promotion contient seulement `proposalId` et `decisionId`. La promotion refuse un accord sur d'autres octets, une décision refusée ou une correction éditoriale sans preuves correspondantes. Elle écrit la fiche versionnée mais ne réalise aucun commit ou push.

## Campagnes

```text
node scripts/browser-recipe.mjs campaigns start --input artifacts/campagne.json
node scripts/browser-recipe.mjs campaigns begin-attempt --input artifacts/debut-parcours.json
node scripts/browser-recipe.mjs campaigns record --input artifacts/resultat-parcours.json
node scripts/browser-recipe.mjs campaigns finish --input artifacts/fin-campagne.json
node scripts/browser-recipe.mjs campaigns report --input artifacts/rapport-campagne.json
```

- **start** : `selection` ordonnée d'identifiants approuvés, `deployment`, source d'`authorization`, date `startedAt`, `executor`, `tool`, `browser`, `device` (`desktop` ou `mobile-simulated`), `model`, `effort`, et `preparations`. Modèle/effort valent `null` si indisponibles ou `{value, source}` si réellement connus. La cible porte `environment: Dev`, `url`, `id`, `commit`, source `{path,sha256}` et `observedAt`. Une identité inconnue peut documenter une campagne bloquée, jamais un PASS.
- **begin-attempt** : `campaignId`, `scenarioId`, date `startedAt`, observation `deployment`, `preflight` indiquant `syntheticAccountsAuthorized`, `preconditionsMet` et `browserAvailable`, et éventuellement `resumes` pour relier une tentative interrompue. Fournir à chaque tentative son contexte effectif `executor`, `tool`, `browser`, `device`, `model` et `effort` ; modèle/effort indisponibles valent explicitement `null`, sans héritage du contexte de campagne. Ne commencer qu'après les prérequis et la sélection réellement obtenus.
- **record** : `campaignId`, `attemptId`, date `endedAt`, `outcome` (`PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`), `waitingMs` mesurées ou `null`, `steps`, `observations`, `limitations`, références `evidence`, observation `deployment` et `environmentState`. L'état vaut `reliable` ou explicite `session-invalid`, `deployment-changed`, `data-contaminated`, `mutation-uncertain`. Les gestes restent la responsabilité de l'agent Browser Use. Le moteur calcule la durée depuis les horaires réels fournis ; ne pas inventer une durée de parcours non exécuté.
- **finish** : `campaignId`, `finishedAt`, `reason`. Fige un résultat qui rend compte de toute la sélection. Une interruption ou non-exécution ne devient pas un succès.
- **report** : `campaignId`. Lecture seule des résultats, tentatives et réserves, y compris une campagne incomplète.

Avant chaque action mutante, rapprocher les identifiants retournés et les fichiers déjà créés. Ne pas recommencer aveuglément après une réponse ambiguë. Un rapport finalisé ne s'écrase pas ; un nouveau passage a sa propre identité. La couverture exige la correspondance de la fiche figée et du déploiement.

## Choix avant les tests manuels

```text
node scripts/browser-recipe.mjs delivery check --input artifacts/choix-recette.json
```

Cette porte interne en lecture seule contrôle le dossier de [choix de livraison](../../../../docs/delivery-governance.md#choix-avant-les-tests-manuels-sur-dev) avant la remise officielle des tests manuels. Le dossier relie la cible Dev, les nouvelles fiches/versions exactes, la source du choix et, le cas échéant, les résultats de campagne et la décision après incident. L'agent prépare ce dossier et relit les sources ; Amaury ne remplit aucun JSON. Aucun navigateur, admission de fiche, hook ou écriture distante n'est déclenché.

Le [schéma du dossier](../../../../harness/schemas/browser-recipe-delivery.schema.json) définit `deployment` (Dev, identifiant, commit, URL, observation datée et source), `qa` sourcée (un `PASS` est requis), la référence de périmètre `scope`, la référence `decision` ou `null`, `campaigns` et la référence `manualOverride` ou `null`. Le périmètre conserve le catalogue de départ, les propositions, les analyses d'impact et sa revue indépendante pour distinguer ajouts et anciennes fiches. Le checkpoint peut référencer le dossier par `recipeDelivery: {path, sha256}` avec `nextAction.kind` égal à `recipe-choice` ou `manual-recipe`. `node scripts/lifecycle-check.mjs --checkpoint <checkpoint.json> --action manual-recipe` contrôle alors la remise.

`qa.completedAt` désigne la qualification initiale de ce Dev et `scope.recordedAtUtc` le gel initial de la sélection. Conserver ces dates lors d'un simple rafraîchissement de preuve ou de revue : une nouvelle revue technique sans changement du contenu ne périme pas la décision applicable au même périmètre. Une campagne interrompue peut être représentée par un snapshot exact de `reportCampaign`, encore non finalisé, avec `observedAt` ; conserver son empreinte et les résultats réels. La décision de manuel après incident référence les empreintes exactes des rapports examinés, y compris ce snapshot ; une nouvelle observation exige de vérifier à nouveau sa portée.

| État | Suite attendue |
| --- | --- |
| `BLOCKED` | Corriger le dossier invalide ou ses prérequis ; aucune remise manuelle. |
| `CHOICE_REQUIRED` | Présenter les nouvelles fiches et demander Browser Use ou manuel direct ; sans réponse, attendre. |
| `ADMISSION_REQUIRED` | Après choix Browser Use, obtenir les validations nécessaires et admettre les fiches exactes avant campagne. |
| `CAMPAIGN_REQUIRED` | Conduire la campagne autorisée sur la sélection exacte admise. |
| `REDECISION_REQUIRED` | Présenter les résultats et réserves, puis obtenir le choix de traitement ou de manuel explicite. |
| `READY_FOR_MANUAL` | Remettre les tests manuels sur le Dev identifié avec résultats et réserves ; le manuel direct conserve `NOT_RUN`. |

Le code de sortie vaut `1` pour `BLOCKED` et `0` pour les autres états, y compris ceux en attente : seul `manualReady: true`, associé à `READY_FOR_MANUAL`, permet la remise. Un état favorable atteste la cohérence du dossier, pas l'authenticité du consentement ni une réussite UI. Cette porte ne bloque pas tous les messages libres ; son emploi est une obligation de delivery. Réutiliser une décision couvrant exactement le même déploiement et les mêmes fiches ; sinon, demander le choix actualisé.

## Analyse d'impact pendant la livraison

```text
node scripts/lib/browser-recipe-impact.mjs check artifacts/recipe-impact.json
node scripts/verify.mjs --recipe-impact artifacts/recipe-impact.json
```

L'analyse suit [le schéma d'impact](../../../../harness/schemas/browser-recipe-impact.schema.json). Elle réside dans les artifacts ignorés du worktree pendant la vérification, avec ses sources et sa revue ; ses preuves sont préservées dans la racine primaire pour la clôture. `recipeImpactDigest` lie l'analyse hors référence de revue, pour éviter une empreinte circulaire. Le candidat est identifié depuis les sources exactes du worktree, pas depuis le stockage primaire.

Une analyse relue distingue ajouts, modifications, retraits, parcours inchangés ou absence d'impact justifiée ; les réserves restent explicites. `verify` capture ses références parmi les entrées figées. Sans analyse locale disponible, le résultat dédié est non exécuté : la CI ne prétend pas examiner un dossier privé absent.
