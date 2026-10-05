# Reprise des mails par un trigger Neon

Ce relais appelle une fois le [worker existant](../scripts/mail-worker.mjs) quand
un trigger planifié Neon valide arrive. Il conserve l'envoi immédiat, les verrous,
l'idempotence et les règles de l'outbox décrits dans
[l'exploitation des mails](operations/family-mail.md). Il ne se connecte ni à SQL
ni à S3 et n'ajoute aucune dépendance. Il ne constitue pas une preuve de cadence
distante tant qu'un vrai déclenchement automatique n'a pas été observé.

## Contrat et provenance

Le module exporte par défaut `{ fetch(request) }` pour Node.js 24. Il accepte
uniquement `POST /mail` sans query, un corps JSON de 4 096 octets au maximum lu en
cinq secondes au plus, et cette enveloppe native :

```json
{
  "version": 1,
  "invocation_id": "inv-synthetic",
  "trigger": { "type": "schedule", "id": "trigger-synthetic", "name": "hestia-mail-retry" },
  "data": { "scheduled_at": "2026-10-05T12:07:00Z" }
}
```

La confiance repose sur le **proxy natif Neon**, qui retire les en-têtes clients
`x-neon-*` avant d'injecter les siens. Le relais exige ensuite
`x-neon-trigger-invocation-id`, égal à l'identifiant du corps, le nom de trigger
attendu et la branche attendue. Cette égalité ne serait pas une authentification
sur un autre hébergeur ou sur une route exposant directement le handler. Un test
local avec un en-tête inventé ne prouve donc pas cette protection.

Le JSON doit avoir exactement les champs montrés, une version numérique `1`, des
identifiants non vides alphanumériques/tirets/underscores de 200 caractères maximum,
et une date UTC valide avec suffixe `Z`. Les champs supplémentaires sont refusés.
`version` est celle de l'enveloppe, pas celle de la configuration du trigger.
Il n'y a pas de limite d'ancienneté arbitraire qui empêcherait une reprise native.

Le relais refuse avant lecture des secrets si la méthode, le chemin, la provenance,
la branche ou le corps ne conviennent pas. Il appelle ensuite `invokeMailWorker`
une seule fois : `POST /api/hestia/mail-worker`, sans corps, sans redirection,
avec son délai de 55 secondes. La lecture entrante a sa borne distincte de cinq
secondes. Ni l'URL ni le corps appelants ne peuvent choisir la destination.
Les invocations concurrentes restent indépendantes ; les verrous serveur existants
garantissent la reprise, sans prétendre à une exclusivité mémoire distribuée.

Après un appel autorisé au worker, la runtime écrit une seule ligne JSON avec
`invocationId`, `triggerId`, `scheduledAt`, `status` et `httpStatus`, pour corréler
les passages natifs. Les refus ne sont pas journalisés par le module et une erreur
de journalisation n'entraîne pas de reprise. Une réponse autorisée expose uniquement PASS/FAILED,
le statut HTTP distant, l'identifiant natif et la date planifiée. Les refus et
erreurs internes sont minimisés ; corps distant, exception, mail, secrets et
configuration ne sont jamais renvoyés. Aucun succès n'est produit après un échec
HTTP, une erreur réseau ou un timeout.

## Configuration de confiance

| Variable | Rôle |
| --- | --- |
| `AUTH_BASE_URL` | Origine HTTPS exacte choisie par l'opérateur, sans slash final, identifiants, chemin, query ou fragment |
| `MAIL_WORKER_SECRET` | Secret existant du worker, au moins 32 caractères ASCII visibles sans espace |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Accès existant à la protection Vercel, au moins 16 caractères ASCII visibles sans espace |
| `HESTIA_EXPECTED_BRANCH` | Nom de branche attendu, `dev` pour l'opération Dev |
| `HESTIA_MAIL_TRIGGER_NAME` | Nom du trigger attendu, `hestia-mail-retry` pour l'opération Dev |
| `NEON_BRANCH` | Nom injecté par Neon, doit égaler strictement la branche attendue |

Les deux secrets sont obligatoires et bornés à 4 096 caractères. L'opération Dev
fixe l'origine à celle du déploiement Dev approuvé et relit son identité avant
transfert. Une autre destination exige sa configuration et son autorisation
propres ; rien n'autorise Production par héritage. Le garde de branche empêche une
copie vers une branche enfant de reprendre les mails Dev avec les mêmes réglages.
Les credentials SQL/S3 injectés automatiquement par Neon restent inutilisés.

## Package et opération ciblée

Après qualification du candidat exact, fabriquer un ZIP avec **seulement** :

```text
index.mjs
scripts/neon-mail-retry.mjs
scripts/mail-worker.mjs
```

Le contenu exact du shim `index.mjs` est :

```js
export { default } from './scripts/neon-mail-retry.mjs';
```

Préserver les octets des deux modules approuvés et leurs chemins. Ne pas les
aplatir avec esbuild : le garde CLI du worker utilise `import.meta.url`, et le
bundling pourrait le transformer en invocation au chargement de l'entrypoint.
Le test du package froid vérifie l'absence d'appel réseau et de sortie console.
N'inclure ni `.env`, ni config de compte, ni autre source privée.

L'API ciblée est
`POST /api/v2/projects/{project_id}/branches/{branch_id}/functions/{slug}/deployments`
sur `https://console.neon.tech`, avec un multipart `zip`, `runtime=nodejs24` et
`environment` contenant une seule chaîne JSON de la map de variables. Ne pas
utiliser un `config apply` qui pourrait modifier les autres services. Le slug
doit être réservé dans le plan de l'opération. Poller ensuite l'état du déploiement ;
une acceptation HTTP ne prouve pas une fonction disponible.

Le transfert privé lit la clé du profil Dev explicite et les deux secrets
directement en mémoire depuis leurs sources autorisées. Les valeurs ne passent
jamais par argv, logs, réponse brute, dépôt ou fichier hors coffre Cryptomator
vérifié. `functions deploy --env KEY=VALUE` ne convient donc pas aux secrets.
Les métadonnées relues indiquent seulement noms de variables, identifiants et état.
Consigner l'intention avant mutation et réconcilier un résultat ambigu avant tout
réessai. Ne pas créer de nouvelle clé ou élargir les droits pour ce relais.

## Qualification et bascule Dev

1. Confirmer candidat, revue indépendante, autorisation Dev, région supportée
   (Frankfurt est documentée), profil/projet/branche et plan Free actuels.
2. Déployer le package exact par opération privée ciblée, puis créer le trigger
   attendu **désactivé**, chemin `/mail`, cron numérique UTC à quinze minutes
   (par exemple `7,22,37,52 * * * *`). Relire noms, cible, cron et activation.
3. Sur l'URL native réelle, vérifier qu'un POST externe sans en-tête, puis avec
   un en-tête `x-neon-trigger-invocation-id` usurpé, sont refusés sans appel métier.
   Ne pas envoyer les secrets du worker dans ces requêtes de test.
4. Une fois le relais disponible, les refus publics vérifiés et le trigger toujours
   désactivé, désactiver la variable d'activation de l'ancien cron GitHub Dev par
   l'opération autorisée et relire cet état. Le faire avant de préparer les mails
   synthétiques et d'activer Neon permet d'attribuer les passages au nouvel ordonnanceur.
5. Activer le trigger dans le périmètre Dev autorisé. Observer un vrai passage
   planifié sur une outbox synthétique non vide, le traitement et la réception,
   puis un autre passage sans doublon. Conserver dates/identifiants/statuts
   minimisés, sans corps de mail ni jeton. Observer aussi la cadence dans la durée
   convenue ; un appel manuel ne remplace pas cette preuve.
   Garder le secours manuel du worker et distinguer cadence, livraison et réception
   en boîte principale. La bascule n'est qualifiée qu'après ces observations.

Le retour opérationnel consiste à désactiver le trigger Neon puis à utiliser le
secours manuel existant. L'opération de repli peut restaurer la valeur précédente
de la variable GitHub ; cette restauration de configuration ne prouve pas une
reprise automatique, la cadence GitHub restant non qualifiée. Préserver outbox et
données. Pour tourner une clé, organiser la mise à
jour cohérente du worker et du relais, déployer la nouvelle configuration en
mémoire, puis répéter les vérifications avant de réactiver le trigger. Aucune
rotation n'est implicite dans l'installation de ce relais.

## Limites explicites

Les limites Free documentées le 5 octobre 2026 sont 10 Capacity-Hours actives,
400 heures d'attente et un million d'invocations mensuelles, au niveau compte et
projet. Quinze minutes représentent au plus 2 976 appels sur 31 jours et environ
45,47 heures d'attente à 55 secondes chacun. Cela ne prédit ni le CPU ni les autres
consommations partagées ; vérifier le plan et les quotas avant activation.

L'URL native est publique. Un refus précoce protège le worker mais consomme une
invocation ; un abus peut épuiser les quotas Free et affecter la disponibilité.
Aucun WAF propre à cette fonction ni SLA de ponctualité n'est établi ici. La
cadence quinze minutes ne garantit pas le rattrapage d'un OTP expirant en dix
minutes ; l'envoi immédiat reste essentiel. Le classement anti-spam n'est pas
garanti. Cette livraison locale ne vaut ni preuve d'exploitation Dev ni GO Production.

Sources primaires : [triggers](https://neon.com/docs/compute/functions/triggers/overview),
[cron](https://neon.com/docs/compute/functions/triggers/schedule),
[déploiement](https://neon.com/docs/compute/functions/deploy),
[variables](https://neon.com/docs/compute/functions/environment-variables),
[limites](https://neon.com/docs/compute/functions/reference/runtime-limits),
[offres](https://neon.com/docs/introduction/plans).

Contrôle local ciblé : `node --test tests/harness/neon-mail-retry.test.mjs`.
