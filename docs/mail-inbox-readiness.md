# Réception mail : préparation et retour opérationnel

Ce document décrit les conditions de livraison ; il ne constitue pas une preuve de déploiement ou de recette. La configuration réelle, le candidat exact et les résultats restent consignés par environnement dans les preuves de livraison.

## Configuration distincte par environnement

La réception reste fermée sans `HESTIA_INBOX_ENABLED=true`, une adresse technique, une identité de relais, son epoch et son secret. Le raccordement utilise les variables `HESTIA_INBOX_ADDRESS`, `HESTIA_INBOX_RELAY_ACTOR`, `HESTIA_INBOX_RELAY_EPOCH` et `HESTIA_INBOX_RELAY_SECRET`. Les identités Dev et Production sont distinctes ; une configuration croisée est refusée. Les valeurs secrètes sont transférées directement entre leurs sources autorisées et le coffre vérifié, jamais dans le dépôt ou un compte rendu.

L'activation de l'environnement ne remplace pas les choix du membre : réception et analyse automatique sont deux réglages privés séparés. L'adresse d'envoi doit être son adresse de connexion vérifiée et courante, dans le profil Gmail qualifié. Hestia n'accède à aucune boîte personnelle. Le filtre Gmail ne fournit pas un verdict antivirus par fichier.

L'IA documentaire utilise les mêmes réglages et le même budget financier que la classification existante. Le résumé demande en plus `HESTIA_SUMMARY_REMOTE=openrouter-summary-dev` ou `openrouter-summary-production` et `HESTIA_OPENROUTER_SUMMARY_PROFILE`. Ce profil doit référencer une qualification du contrat de résumé exact ; copier l'ancienne qualification des suggestions ne l'active pas. Une indisponibilité, une limite atteinte ou un coût incertain laisse le rangement manuel possible.

## Ordre de préparation

1. Figer et relire le candidat complet, ses nouvelles dépendances, les migrations016–018 et les recettes fonctionnelles applicables.
2. Sauvegarder les métadonnées et les objets avec leur provenance ; vérifier une restauration isolée et l'intégrité des originaux. Conserver les reçus et tombstones de réception, les versions et leurs échéances.
3. Appliquer les migrations explicitement sur la base directe du bon environnement. Aucun appel HTTP ne migre la base.
4. Déployer le candidat avec la réception et les nouvelles capacités IA fermées, puis vérifier admission, droits et originaux existants.
5. Qualifier le nouveau contrat IA sur des documents synthétiques avec le vrai registre financier, avant d'activer son profil. Un résultat local ne devient pas une qualification du fournisseur.
6. Installer le relais privé dans la boîte technique correspondante, obtenir les consentements nécessaires, puis qualifier ses permissions et son déclencheur réel. Un relais préparé en fichier n'est pas installé. Les deux environnements ne partagent ni secret ni consentement.
7. Jouer les nouveaux parcours Browser Use autorisés sur le déploiement Dev exact. Les tests Playwright locaux, y compris ceux utilisant les vraies API/SQL/objets, ne remplacent pas cette recette.

Les limites et les raisons de refus du profil MIME sont décrites dans [le raccordement mail](mail-ingress.md). Le brut est transmis par fragments ; une PJ admise conserve exactement ses octets. Les ressources du corps et les signatures ne deviennent pas des documents.

## Travaux durables et échéances

Les nouveaux originaux génèrent un travail documentaire transactionnel ; la migration des documents historiques n'en crée aucun. Un résumé appartient au contenu immuable, y compris lorsqu'il arrive après un remplacement ou un rétablissement. Le contexte mail et le commentaire n'entrent que dans les propositions privées de rangement.

Le heartbeat du relais réveille des traitements bornés après réponse, même sans nouveau mail. Il possède une signature et des nonces propres ; il n'accorde aucun accès à la route de maintenance. Chaque invocation réserve une marge pour le fournisseur et respecte le temps déjà consommé par la requête. Les lectures d'un original sont bornées à dix plages de2Mio parallèles. Une lecture reportée conserve son travail et laisse passer les autres ; une dépense possiblement engagée conserve sa réservation inconnue. Une génération périmée ne publie aucun résultat.

Les PJ en attente n'expirent pas sous quota. Les PJ écartées et les anciennes versions deviennent inaccessibles après168heures, indépendamment de la date du passage physique du nettoyeur. Un échec de suppression garde la charge de stockage. Une version expirée peut conserver une ligne d'historique opaque, sans ancien nom, résumé ni action de récupération.

La vue d'historique conserve le courant et les versions encore récupérables, avec une borne de1000versions actives par document. Elle affiche au plus100lignes expirées récentes ; les autres tombstones restent conservés sans fermer l'accès aux versions récupérables. Cette limite de présentation n'efface aucun reçu et ne prolonge aucune échéance.

## Retour sans perdre les nouvelles données

Après réception ou remplacement, revenir aveuglément au précédent binaire est dangereux : ses anciens nettoyeurs ne connaissent pas les originaux protégés par les versions. Le plan de retour doit être relu et répété sur une copie synthétique du schéma enrichi.

Le premier arrêt opérationnel consiste à fermer la réception et les appels IA dans la configuration de l'environnement, en conservant le code compatible avec016–018. Les nouveaux mails restent alors chez Google sans accusé terminal inventé ; les originaux, reçus et PJ déjà reçus restent dans Hestia. Le classement manuel et les droits continuent d'utiliser le schéma enrichi. Ne pas supprimer les tables, réinitialiser les epochs ou effacer les tombstones pour tenter de reprendre un mail.

Une restauration de sauvegarde exige de réconcilier les événements, objets et opérations postérieurs. Aucun original durable n'est supprimé pour faire correspondre artificiellement une ancienne sauvegarde. Un résultat incertain impose l'observation et la réconciliation avant toute répétition de migration, publication ou effet externe.
