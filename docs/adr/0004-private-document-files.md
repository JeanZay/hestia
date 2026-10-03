# ADR-0004 — Fichiers documentaires privés

3 octobre 2026 — tranche #18. Cible Vercel + Neon ; qualification locale synthétique dans ce lot. Aucun service distant créé ou déployé par cette décision.

## Transfert et conservation

Les originaux résident dans un bucket S3 privé et les métadonnées dans PostgreSQL. L'interface serveur `put/getRange/delete` évite de lier les règles métier à un fournisseur. Le navigateur passe uniquement par les routes Hestia authentifiées ; il ne reçoit ni clé S3 ni URL autonome donnant accès au stockage.

Les fichiers de 20 Mio au maximum sont transmis par fragments de 2 Mio au maximum, compatibles avec le plafond documenté de corps HTTP de Vercel. Le serveur contrôle taille, empreinte SHA-256 et format avant publication. Les parseurs s'exécutent dans un processus enfant sous délai et limites d'entrée/pixels/heap ; le plafond du heap n'est pas une garantie de plafond RSS natif. Les mesures du banc local ne préjugent pas des ressources disponibles sur Vercel.

Une opération SQL réserve le quota, rattache les fragments au membre et au dossier, et porte l'identité de réessai. La finalisation publie ensemble les métadonnées et le reçu. Une erreur après écriture S3 laisse une référence d'objet temporaire connue pour réconciliation. Les originaux publiés ne sont jamais remplacés par une route applicative. Cette immuabilité applicative n'est pas une garantie WORM contre l'administrateur du stockage.

Le verrou d'opération est un verrou consultatif de session PostgreSQL : `DATABASE_URL` doit utiliser la connexion directe Neon, sans `-pooler`, avec un petit pool applicatif. Le [pool transactionnel Neon](https://neon.com/docs/connect/connection-pooling) ne conserve pas ce type de verrou entre transactions. Cette contrainte doit être vérifiée au raccordement Dev, sans changer les bases existantes dans ce lot.

Les droits courants sont revérifiés pour les mutations et avant la remise des portions de contenu. L'aperçu exige Consulter ; le téléchargement exige aussi Exporter. Un aperçu complet reste une copie remise au navigateur : on ne peut pas rappeler les octets déjà reçus. Les réponses privées sont non cachables ; l'interface libère ses Blob temporaires à la fermeture et à la perte de session.

## Bornes et exploitation

Le quota du propriétaire du dossier inclut les documents actifs, ceux en corbeille et les réservations. Les bornes initiales sont de 1 Gio par propriétaire et de 4 Gio globalement. Cette dernière borne laisse une marge pour les objets temporaires ; elle ne certifie pas le volume physique facturé par le fournisseur. Aucun dépassement n'efface un document ni ne déclenche un abonnement payant.

La tranche #18 traite les opérations d'envoi et leur nettoyage interne borné. Le partage, l'interface de corbeille, sa purge quotidienne fiable et la qualification Dev restent les tranches #19/#20. Le nettoyage opportuniste ne constitue pas une planification quotidienne sur un hébergement serverless.

## Banc local

`tests/helpers/with-postgres.mjs` réserve des conteneurs PostgreSQL et RustFS propres à chaque exécution. RustFS 1.0.1 est un serveur S3 de test sous Apache-2.0, figé au digest Linux amd64 `sha256:7465b31993156ca5cc0eb4b3c59a01ff69651961be62bcfeb6ce569f22034a56`. Il ne devient pas un service durable Hestia.

Ports loopback aléatoires, identifiants en mémoire, données tmpfs et réseau propre sans masquerading/intercommunication : le banc ne reprend aucune configuration SQL/S3 ambiante. Avant les tests applicatifs, il vérifie un refus HTTP 403 pour la lecture anonyme d'un objet existant et une lecture Range signée exacte. Il supprime seulement ses ressources nommées et étiquetées, puis vérifie la préservation des conteneurs préexistants. Les reçus ignorés par Git distinguent ces contrôles des résultats applicatifs.

Un aller-retour de sauvegarde synthétique SQL + objets + empreintes est prévu pour vérifier la conservation de nos fichiers. Ce contrôle n'est ni une sauvegarde de données familiales, ni un exercice de migration de fournisseur. L'essai physique de la caméra mobile et les limites réelles Vercel/Neon nécessitent la recette Dev.

Sources officielles : [limites Vercel](https://vercel.com/docs/functions/limitations), [compatibilité S3 Neon](https://neon.com/docs/storage/s3-compatibility), [installation Docker RustFS](https://docs.rustfs.com/en/installation/container/docker). Références relues lors du cadrage et du choix du banc ; les capacités hébergées devront être éprouvées sur le candidat Dev.
