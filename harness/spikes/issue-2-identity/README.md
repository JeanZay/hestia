# Banc expérimental Issue 2 — aucune intégration produit

Ce dossier est un test-bench isolé et local. Il ne fournit aucune route Next.js,
UI, service, configuration Dev/Production ni coffre utilisable. Ne pas copier
ses fixtures, son provisioning SQL ou ses API privées dans une application.

## Exécution

Node 24.15.0, Better Auth 1.7.6, verrou exact. Après inspection du verrou et des
archives : `npm ci --ignore-scripts --no-audit --no-fund`, puis `npm test`.
`node run.mjs identity.test.mjs` exécute seulement l'identité. Le lanceur réduit
l'environnement hérité ; le processus d'identité refuse fetch, sockets et HTTP.
Aucun serveur n'écoute ; Request/Response sont appelés en mémoire et tous les
messages/jetons synthétiques restent dans le processus. Bases SQLite `:memory:`
fermées après chaque test, aucune donnée familiale et aucun e-mail envoyé.

`audit-dependencies.mjs` est une commande réseau de PRÉINSTALLATION distincte :
elle lit les archives npm verrouillées en mémoire, contrôle intégrité/inventaire,
relève scripts/licences et produit un rapport sans les extraire ni les exécuter.
Ce contrôle ne vérifie pas à lui seul la signature de l'éditeur ni l'absence de
code malveillant. Le graphe inclut des adaptateurs non activés et la télémétrie
désactivée. Un `prepare: husky` transitif est identifié mais jamais exécuté.

## Ce qui est réellement éprouvé

`identity.test.mjs` appelle Better Auth réel sur son adaptateur Node SQLite,
avec rate-limit en base (pas le cache mémoire partagé entre instances de test).
Inscription fermée, vérification avant session, cookies, expiration/révocation,
activation POST sur invitation possédée, concurrence mono-processus, bootstrap
unique, récupération à usage unique et confirmations liées à acteur/action/cible
et versions sont exercés. L'identité de boîte e-mail est simulée par la remise
du jeton dans une capture mémoire ; aucune délivrabilité réelle n'est prouvée.

La route brute GET de vérification modifie l'état : son test est un
CONTRE-EXEMPLE, pas un succès de sécurité. L'enveloppe à liste fermée la refuse.
Même distinction pour le hook de reset défaillant : le chemin brut laisse une
session active ; l'adaptateur d'essai révoque avant mutation dès qu'une preuve
de récupération valide est présentée. La revue a reproduit une connexion
concurrente échappant à cette seule révocation : une génération de session et
un état de récupération ferment désormais cette fenêtre dans le banc. Deux
régressions à barrières déterministes vérifient connexion pendant récupération
et connexion déjà en cours avant son début. Ce n'est toujours pas une preuve
multi-processus PostgreSQL. Une panne peut exiger un nouveau lien.
La revue a aussi reproduit une invitation en vol émise après invalidation de
sa session (R2). La transaction d'émission revalide maintenant génération et
état de récupération ; une régression déclenche la vraie récupération entre
contrôle de session et émission et exige zéro invitation et zéro message.
Les erreurs synthétiques injectées produisent un HTTP 500 attendu dans les logs.

Les confirmations produisent seulement un reçu d'admission lié à une intention.
Elles n'effectuent pas le transfert réel, le changement d'e-mail, la nomination
d'administrateur ni la suppression d'espace. Les cibles sont enregistrées par
fixtures de confiance ; leur autorisation métier complète reste à intégrer.
Les méthodes seed/proofFor/registerTarget/raw sont des contrôles de banc, pas
des entrées publiques. Une reprise produit devra remplacer les accès SQL et
API internes de provisioning par un contrat de version éprouvé et atomique.

`policy.mjs` et `policy.test.mjs` sont un modèle séparé de droits et ses oracles
synthétiques ; ses fixtures sont de confiance et ne prouvent pas des ressources
créées par une vraie application. Se reporter aux scénarios réellement nommés
dans les tests, pas à une promesse de couverture intégrale de l'Issue 2.

## Complément PostgreSQL du 27 septembre 2026

Docker est désormais disponible ; aucune réparation ou réinitialisation n'a été
nécessaire. Depuis la racine du worktree, après audit/installation du verrou :
`node harness/spikes/issue-2-identity/pg-driver.mjs --verify` exécute les contrôles
du dépôt, le corpus SQLite historique et le corpus PostgreSQL obligatoire.
Sans `--verify`, seul le corpus PostgreSQL est exécuté. Un lancement direct de
`verify.mjs` sans endpoint dédié échoue : aucun ancien PASS SQLite ne vaut PG.

Le driver réutilise uniquement l'image locale immuable PostgreSQL 17.11 dont
l'identité figure dans sa source. Aucun téléchargement d'image implicite. Il
crée son propre conteneur, mot de passe éphémère en mémoire, réseau étiqueté,
port aléatoire lié à 127.0.0.1 et stockage tmpfs de 1 Gio (mémoire max 1,5 Gio).
Il vérifie identité, montages et réseau, puis arrête ses seules ressources et
compare l'inventaire préexistant. Les données synthétiques du run disparaissent
à cet arrêt ; aucun volume hôte ni base d'un autre projet n'est utilisé.
Le reçu `artifacts/pg-runs/<run-id>/runtime.json` est séparé des preuves de tests :
il faut vérifier les DEUX pour qualifier une exécution et son nettoyage.
Les options de réseau limitent masquerade/inter-container ; ce n'est pas un
air-gap certifié. La barrière JavaScript du client n'autorise que ce port PG
et refuse fetch/TLS/HTTP/autres sockets ; ce n'est pas un sandbox système.

`pg-identity.test.mjs` appelle la vraie bibliothèque Better Auth avec pg
8.16.3 : deux pools, second processus, cookies/secrets cohérents, révocation,
expiration, reset et non-rejeu. Deux appels reset lancés concurremment ne sont
pas une preuve de contention déterministe. Le hook de reset défaillant conserve
une ancienne session : ce résultat attendu est un CONTRE-EXEMPLE, pas une
garantie de sécurité. Le dépassement de longueur de mot de passe en connexion
était également un diagnostic de 1.7.5, conservé dans le candidat de PR15.
Le lot suivant passe explicitement à 1.7.6 et exige maintenant le rejet avant
vérification du mot de passe ; voir la décision de version ci-dessous.

`pg-protocol*.mjs` est un MODÈLE SQL distinct, sans appel Better Auth : propriétaire
unique, activation unique, intention et effet synthétique atomiques, révocation,
délégation limitée à un parent direct, reçus idempotents. Il observe de vraies
attentes de verrou et reprises après conflit, et interrompt ses seuls workers
avant/après COMMIT. Un compteur représente l'effet sensible. La récupération
prouve seulement une fermeture persistante après admission et mort du client :
aucun protocole complet de reprise/déverrouillage n'est livré. Ni crash du serveur
PostgreSQL ni panne de l'hôte ne sont testés ; tmpfs ne prouve pas la durabilité
sur disque. Les sessions q_* ne sont pas les sessions Better Auth.

## Limites bloquantes pour l'adoption produit

- Le complément PostgreSQL borne les essais décrits ci-dessus ; il ne porte
  pas l'intégralité de l'adaptateur SQLite sur PostgreSQL et ne prouve pas
  l'intégration bibliothèque + droits métier + récupération complète.
- Les sessions et le modèle de droits sont testés séparément ; pas de preuve
  d'intégration de tous les adaptateurs métier ni de transport/streaming réseau.
- Pas de cycle complet e-mail changé/ancien lien, secours exceptionnel/codes
  de récupération, retentions, anti-abus distribué, quotas physiques, stockage,
  sauvegarde/restauration ou suppression durable. Ne pas déclarer B1 fermé.
- Aucune UI, accessibilité ou recette Dev ; Design System et hand-off restent
  nécessaires (B2). Aucun appel de Claude et aucune mutation GitHub.

## Décision de ce banc

Better Auth reste un candidat à poursuivre AVEC adaptateurs Hestia et réserves,
pas une solution prête à brancher. Les contre-exemples doivent rester des tests
de régression ; aucune adoption de production n'est déduite de tests verts.
La revue indépendante et les preuves exactes sont conservées séparément dans
le dossier local de qualification référencé par le checkpoint principal.

## Qualification intégrée bornée — lot suivant du 27 septembre 2026

Contrat : `harness/contracts/issue-2-integrated-qualification.json`. Le terme
« intégrée » désigne ici bibliothèque + admission Hestia + droits courants
dans le banc, jamais un raccordement à Next.js ou une livraison produit.

`pg-integrated.mjs` relie le cookie réellement signé par Better Auth à une
admission persistante dont la génération a été capturée AVANT la vérification
du mot de passe. Chaque accès relit l'état PostgreSQL : session, admission,
membre actif, génération, récupération, état des dossiers et provenance des
droits. Aucun rôle global ne donne la lecture d'un espace personnel.
Les ressources et attributions sont synthétiques ; l'oracle de politique
existant est chargé depuis un snapshot conservé en base, sous verrou de banc.

Seules la lecture O01 et l'export synthétique O07 sont exécutés par cette
frontière. Les bindings O01–O10 sont explicites mais les autres opérations y
sont refusées ; leurs tests historiques restent des modèles séparés. La
création atomique des sept droits d'un espace est une commande de fixture de
confiance, pas une activation d'invitation ni un bootstrap utilisable. Les
contrôles de récupération modélisent une transition persistante de génération,
pas l'admission d'une vraie preuve ni le protocole complet de changement du
secret. Ne pas fermer les cinq scénarios produit ouverts à partir de ce lot.

La remise d'un résultat préparé recontrôle toutes ses sources et les droits.
Cela mesure la frontière d'appel en mémoire, pas les buffers HTTP, le streaming
réseau ou des octets déjà transmis. Les essais à deux pools/instances ne sont
pas des essais de crash serveur ou de durabilité disque ; le driver reste tmpfs.
Le verrou de banc n'est pas une stratégie de contention adoptée pour le produit.

### Décision technique de version

Better Auth **1.7.6 exact** remplace 1.7.5 ; pg **8.16.3**, Kysely **0.29.5** et
nanostores **1.5.3** sont conservés pour limiter le delta. La
[release officielle](https://github.com/better-auth/better-auth/releases/tag/v1.7.6)
corrige le rejet tardif des mots de passe trop longs. Le test PostgreSQL
vérifie désormais HTTP 400, `PASSWORD_TOO_LONG` et zéro appel de vérification.
Le contre-exemple du hook de reset défaillant reste attendu : cette mise à
jour ne rend pas la récupération Hestia complète ni atomique.

Relecture officielle au 27 septembre 2026 :

- [PostgreSQL](https://better-auth.com/docs/adapters/postgresql) et
  [base/migrations/hooks](https://better-auth.com/docs/concepts/database) :
  surfaces publiques, sans garantie de transaction commune avec nos droits.
- [Sessions](https://better-auth.com/docs/concepts/session-management) :
  cache cookie désactivé, pas de stockage secondaire dans ce candidat.
- [GHSA-fmh4-wcc4-5jm3](https://github.com/better-auth/better-auth/security/advisories/GHSA-fmh4-wcc4-5jm3) :
  le plugin organization concerné n'est pas activé ; l'e-mail vérifié reste
  requis. Son ajout exigerait une nouvelle qualification. Un audit npm vide
  ne constitue pas une certification ni la résolution de cet avis.

Les 37 archives du verrou ont été inspectées avant installation : intégrité,
inventaire, licences MIT/Apache-2.0/ISC et scripts ; installation avec scripts
désactivés. Aucun envoi d'e-mail, activation de plugin supplémentaire, donnée
réelle, appel Claude, UI, route produit ou déploiement.
