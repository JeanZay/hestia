# Courriels des accès familiaux

Le transport envoie uniquement les trois modèles texte des parcours d’identité
existants. Aucun document, pièce jointe ou secret documentaire n’est ajouté.
L’outbox persistante chiffrée reste la source de reprise. Cette procédure décrit
la configuration attendue ; sa présence ne prouve ni activation, ni recette Dev.

## Configuration du serveur

| Variable | Usage |
| --- | --- |
| `HESTIA_MAIL_PROVIDER` | `resend` active le transport ; garder l’envoi désactivé en local. |
| `HESTIA_MAIL_FROM` | Une seule adresse d’expéditeur du domaine vérifié pour l’environnement. |
| `RESEND_API_KEY` | Clé d’envoi limitée au domaine Dev, uniquement côté serveur. |
| `MAIL_WORKER_SECRET` | Secret dédié d’au moins 32 caractères, distinct des clés d’authentification, de maintenance et Resend. |

Configurer uniquement l’environnement autorisé. Les valeurs passent directement
par code vers leur destination, jamais par les arguments d’une commande, les
captures, les logs ou Git. Une copie utile est conservée dans le coffre
Cryptomator après vérification effective de son montage, sans écraser une clé
existante. Un coffre fermé ne justifie pas une copie en clair dans le dépôt.

## Déclenchement et reprise

Après un POST métier réussi et son commit, Next `after` déclenche un lot de
quatre messages au maximum. Cela couvre identité, invitation et réadmission,
y compris la fin de récupération avec changement d’adresse. Un rollback ne
doit pas déclencher d’envoi. Un échec fournisseur ultérieur ne renverse pas la
mutation déjà commise.

`POST /api/hestia/mail-worker` reprend l’outbox avec le même traitement. Il
vérifie l’authentification Bearer dédiée avant de charger le runtime ; une
session familiale seule ne suffit pas. GET ne déclenche aucun traitement.

L’opérateur peut exécuter `node scripts/mail-worker.mjs` avec `AUTH_BASE_URL`
et `MAIL_WORKER_SECRET` fournis dans l’environnement. Si la protection Vercel
l’exige, fournir aussi `VERCEL_AUTOMATION_BYPASS_SECRET`. La commande effectue
un seul POST ; elle ne reçoit aucun identifiant ou secret en argument. Son
résultat minimisé ne remplace pas une vérification de réception.

Chaque appel au fournisseur expire après cinq secondes. Les tentatives sont
limitées à cinq et à une fenêtre de 23 heures depuis la première tentative,
avec la même clé d’idempotence et le même contenu. Les erreurs permanentes
sont terminales ; les erreurs temporaires restent reprenables dans ces bornes.
Une dernière tentative interrompue se clôture après expiration du bail. Un
retour fournisseur tardif ne réécrit jamais un message annulé.

L’envoi d’un OTP dépend de sa preuve active, de son adresse courante et de son
échéance propre de dix minutes, en plus de la validité du flow. Ces conditions
sont recontrôlées juste avant le réseau. Une annulation survenant ensuite peut
laisser arriver un courriel déjà parti ; son code ou lien reste inutilisable.
Après expiration, engager la réémission prévue par le parcours, sans forcer
le rejeu d’un message terminal ni lui attribuer une nouvelle clé d’envoi.

## Planification Dev optionnelle

Le workflow `.github/workflows/dev-mail.yml` est désactivé par défaut. Son
activation est une opération Dev distincte, après revue de la destination et
des accès nécessaires. Il utilise uniquement :

| Paramètre GitHub | Portée |
| --- | --- |
| Variable `HESTIA_DEV_MAIL_ENABLED` | Activation explicite du workflow. |
| Variable `HESTIA_DEV_ORIGIN` | Origine HTTPS du seul déploiement Dev. |
| Secret `HESTIA_DEV_MAIL_WORKER_SECRET` | Autorisation de la route de reprise Dev. |
| Secret `HESTIA_DEV_VERCEL_BYPASS` | Contournement de protection Dev si nécessaire. |

Ne transmettre à ce workflow ni clé Resend, ni accès SQL, ni secret Production.
Le calendrier prévoit un passage toutes les cinq minutes. GitHub peut retarder
ces exécutions et désactive les workflows planifiés d’un dépôt public après
60 jours sans activité. Cette cadence ne garantit donc pas l’arrivée d’un OTP
avant expiration. Voir les [limites des déclenchements planifiés GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Next `after` n’est pas une garantie de reprise sans trafic. Le workflow ne
devient pas actif par sa seule intégration dans le dépôt. Contrôler ses
exécutions réelles et conserver la commande opérateur comme voie de reprise.

## Qualification avant recette

Vérifier séparément configuration Dev, authentification de la route, acceptation
Resend, réception attestée et reprise après panne/interruption. Essayer ensuite
le parcours familial complet, avec des données synthétiques et les seuls
destinataires autorisés. Ne jamais consigner les OTP, liens privés ou valeurs
de secrets dans les preuves. La procédure de secours opérateur conserve ses
propres contrôles. Toute Production attend la recette et le GO explicite sur
le candidat exact.
