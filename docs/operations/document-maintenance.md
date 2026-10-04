# Maintenance des documents

La corbeille devient inaccessible à exactement sept jours, selon l'horloge du
serveur, même si le nettoyage physique n'a pas encore tourné. Les octets restent
comptés dans le quota jusqu'à confirmation de leur suppression du stockage.
La restauration ne modifie aucun droit et n'est jamais possible après l'échéance.

`GET /api/hestia/maintenance` est réservé au planificateur : en-tête
`Authorization: Bearer <CRON_SECRET>`, secret aléatoire distinct d'au moins 32
caractères. Sans secret configuré, la route est fermée. Une session familiale ne
donne aucun accès à cette opération. Ne jamais inscrire ce secret dans une URL,
les logs ou le dépôt. La configuration et son application sont propres à chaque
environnement, après autorisation de son déploiement.

Chaque appel traite au plus vingt documents et cent objets temporaires. Les
échecs conservent le registre de reprise et renvoient 503 ; ne pas présenter une
suppression distante incertaine comme confirmée. Les appels concurrents partagent
les verrous des opérations d'envoi. Un nouveau passage est sans effet sur un
document déjà purgé et ne recrée aucun contenu.

Le fichier `vercel.json` prévoit un passage quotidien à 03:00 UTC.
[Vercel exécute ses crons seulement sur les déploiements Production du fournisseur](https://vercel.com/docs/cron-jobs).
La Preview Hestia Dev actuelle ne déclenche donc pas ce planning automatiquement.
La recette Dev doit appeler explicitement cette même route avec ses secrets
serveur et la protection Vercel, sans les afficher. L'activation d'un planificateur
durable pour cet environnement reste une étape d'exploitation distincte ; ce
fichier ne déploie rien. Les environnements Hestia Dev et Production demeurent
séparés, quel que soit le nom de la cible utilisé par le fournisseur.

Ne pas appliquer une rétention physique automatique S3 en parallèle : la base
doit d'abord rendre le document inaccessible et conserver le suivi de sa
suppression. La purge efface titres, noms et provenance affichable des lignes
opérationnelles ; le reçu technique conservé empêche les anciens réessais de
ressusciter le document. Les empreintes et tailles des objets confirmés supprimés
sont retirées du registre ; les objets dont la suppression reste incertaine y
restent pour permettre la reprise. Aucune suppression immédiate des sauvegardes
n'est promise.
