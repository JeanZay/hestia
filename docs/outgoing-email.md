# Envois documentaires

Une admission courante (compte, epoch, departure_epoch) possède au plus une préparation privée. Après récupération ou réadmission, une nouvelle préparation est possible sans exposer celle d'une ancienne admission. L'ancienne préparation gelée, ses références, son opération et son slot restent protégés jusqu'à réconciliation ; une ancienne préparation non gelée peut être purgée sans toucher aux originaux. Les champs À, objet et message sont chiffrés au repos avec une clé HKDF propre à Envois et AES-GCM lié à l’auteur, au brouillon et à sa révision. Les pièces sont des références : aucune copie S3 n’est créée. Les reçus d’envoi ne contiennent ni composition, destinataire, titre, nom de pièce ni liste de documents.

## API privée

Les routes `/api/hestia/outgoing` utilisent les sessions Hestia, les origines autorisées et des réponses sans cache. `POST` crée une préparation ou retourne celle existante sans la réinitialiser ; `GET` ne crée rien. Les routes `[id]` modifient (`PATCH`) ou abandonnent (`DELETE`) à la révision attendue. Une ancienne mutation sur un identifiant détruit ne fait jamais d’upsert.

`GET available?q=` retourne les documents finalisés actuellement consultables et exportables, tous dossiers autorisés confondus ; les chemins masquent les ancêtres non consultables. `POST [id]/attachments` ajoute des sélections confirmées par identités et versions courantes. La déduplication porte strictement sur documentId : deux fichiers homonymes restent deux pièces, sans renommage. `POST [id]/attachments/[rowId]/accept` confirme explicitement une évolution.

Une ligne inaccessible contient seulement son identifiant de ligne opaque et `unavailable`. Une ligne remplacée porte le nom et la taille du contenu choisi ; `current` décrit séparément la nouvelle version. Le renommage d’un titre déclenche « Titre modifié » avec confirmation, sans changer le filename original envoyé. Un déplacement seul revalide droits et chemin sans fausse alerte de titre.

`POST [id]/check` valide la préparation enregistrée et rend un récapitulatif signé cinq minutes. Il lie enveloppe, identité, epochs, adresse de réponse et prénom SQL courants, documents et versions. `POST [id]/send` exige ce jeton, la révision et un requestId stable. Le prénom SQL est nettoyé pour l’affichage « Hestia au nom de … » ; l’adresse d’expédition est fixe côté serveur. Une évolution de l’adresse de réponse ou du nom invalide la confirmation. Les clients conservent le même requestId pendant une intention ; aucun retry réseau ne crée une clé nouvelle.

`GET operations/[id]` relit uniquement une opération connue de son auteur ; aucune route ne liste un historique ou n’accepte une réconciliation. Après refus certain, une sauvegarde CAS explicite crée une nouvelle révision, puis un nouveau récapitulatif est nécessaire. Après incertitude, la préparation reste verrouillée.

## Bornes et comportement d’envoi

Au plus vingt adresses distinctes et vingt documents ; objet 200 points Unicode, message 20 000 ; corps de mutation 128 Kio. Les destinataires utilisent une partie locale ASCII conservée et un domaine normalisé IDNA, sans display-name ni SMTPUTF8. Le message autorise LF et tabulation ; aucune troncature silencieuse.

Toutes les pièces doivent être finalisées, courantes, hors corbeille/purge et accessibles avec Consulter + Exporter. L’auteur, sa session, son admission, son adresse vérifiée et les droits sont relus avant et après chaque plage S3, puis avant le seul appel fournisseur. Aucun verrou SQL n’est conservé pendant S3 ou Resend. Les contrôles ne rendent pas atomiques une révocation et l’acceptation externe après la dernière vérification.

Total brut maximal 20 971 520 octets ; lecture par plages de 2 Mio, vérification de la taille et du SHA-256 intégral avant tout appel. Le JSON UTF8 encodé est plafonné à 32 Mio ; un fichier invalide bloque toute l’enveloppe. Le budget de transmission est de 45 secondes, avec réserve de dix secondes avant fournisseur et appel de cinq secondes maximum. Les requêtes SQL et la route restent aussi soumises aux délais de l’hôte : les mesures locales ne qualifient pas automatiquement l’hébergement.

Un slot SQL par environnement sérialise les assemblages/transmissions. Chaque propriétaire possède opId, token et génération monotone. Tous les points d’effet utilisent ce tuple et la révision gelée ; un worker périmé ne publie ni ne libère un autre slot. Avant marqueur d’appel, une expiration permet révocation atomique et réadmission d’un autre worker. Après marqueur, une expiration conserve le slot protégé : une suspension après CAS pourrait encore précéder le fetch. Aucune garantie de fencing fournie par Resend n’est supposée. Le fencing SQL ne prouve pas la restitution physique des buffers ; le RSS global absolu reste à qualifier sous suspensions/réadmissions.

L’API Resend attend `reply_to`, les pièces base64 et accepte un nom d’expéditeur avec adresse. Le champ `content_type` est défini dans son schéma officiel. Sa documentation annonce 40 MB encodés et une idempotence de 24 heures ; les bornes Hestia sont plus petites et une intention incertaine n’est jamais retransmise, même après expiration. Références consultées le 18 octobre 2026 : [API Send Email](https://resend.com/docs/api-reference/emails/send-email), [schéma officiel](https://github.com/resend/resend-openapi/blob/main/resend.yaml).

## Réconciliation et nettoyage

Une acceptation certaine purge atomiquement la préparation correspondante. Les reçus terminaux sont supprimés après sept jours, les compteurs d’admission après 48 heures ; les incertains restent protégés. Un résultat tardif ne peut toucher une préparation ultérieure. Le nettoyage borné est raccordé à la maintenance existante, sans ordonnanceur supplémentaire ni campagne navigateur.

`reconcileOutgoing` est une capacité interne au serveur. Elle exige une attestation HMAC propre à Envois, liée à opId, binding du payload, état et providerId éventuel, ainsi qu’une preuve de quiescence. Les tests injectent une autorité fournisseur synthétique. Une déclaration de client, absence de reçu, simple timeout, date dépassée ou résultat de recherche vide ne constitue jamais une preuve.

En exploitation, avant de produire cette attestation, l’opérateur doit rapprocher la clé `hestia/outgoing/<opId>` et la preuve fournisseur accessible avec ses droits déjà autorisés, puis vérifier que l’ancien chemin d’invocation est terminé et ne peut plus appeler. Ni élargissement de clé, polling externe, accès administrateur aux compositions ni nouveau secret n’est créé ici. Sans cette preuve, conserver incertain et slot ; ne pas changer la clé. Un résultat certain rendu tardivement par le transport peut être remis automatiquement à cette même réconciliation après fin effective de son chemin d’appel. Un timeout sans preuve exploitable conserve le blocage ; le code ne prétend pas le résoudre par absence de trace.

## Activation de Dev et Production

Le runtime est fermé par défaut. Le local ignore toujours les paramètres fournisseur et n’admet que le transport `simulated` injecté par les tests. En environnement hébergé, `HESTIA_OUTGOING_ENABLED=true` nécessite `HESTIA_MAIL_PROVIDER=resend`, l’adresse nue existante `HESTIA_MAIL_FROM`, la clé d’envoi existante et un objet JSON `HESTIA_OUTGOING_QUALIFIED_PROFILE`. Aucune valeur secrète ne doit être mise dans une commande affichée ou les preuves.

Ce profil contient uniquement `qualificationId`, `actorHour`, `actorDay`, `globalHour`, `globalDay`, `recipientHour`, `recipientDay`. La référence de qualification commence par `outgoing-` et désigne les preuves réelles du candidat/environnement ; une chaîne syntaxiquement valide ne prouve pas leur exécution. Les plafonds autorisés par le chargeur sont :

| Environnement | Intentions / auteur / heure | / jour | Global / heure | / jour | Destinataires / heure | / jour |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dev | 3 | 5 | 5 | 5 | 10 | 10 |
| Production | 5 | 10 | 5 | 5 | 20 | 20 |

Les fenêtres sont glissantes, les compteurs SQL partagés entre instances du même environnement et une intention admise est comptée une seule fois, incertains compris. Une garde additionnelle borne aussi les demandes refusées et leurs reçus. Les maxima peuvent être abaissés selon le compte. La séparation des services et ces plafonds ne réservent pas atomiquement la capacité ou la réputation des OTP face aux autres applications du compte fournisseur.

Avant activation : prouver domaine et expéditeur vérifiés, droit d’envoi existant, quotas quotidien/mensuel et absence de surcoût ; conserver une réserve pour OTP/réception et usages voisins ; qualifier le candidat exact sur SQL/S3 de l’environnement, 20 Mio/encodage/délais/mémoire, droits après I/O et comportement incertain ; éprouver la procédure de preuve/quiescence avec les droits existants. Une preuve locale ne suffit pas à annoncer un PASS hébergé. Aucun transport réel ou changement d’environnement n’est exécuté par les tests.

## Migration et validation

`021-outgoing-email` est additive ; aucune migration précédente n’est réécrite. Elle ne copie aucun original et ne déclenche aucune analyse ou émission. Un retour à l’application précédente laisse ces tables sans les exploiter ; ne pas supprimer les opérations incertaines ni leurs références pour fabriquer un rollback. Les contrôles de migration sont rejoués sur le banc synthétique possédé. Le lancement effectif de l’ancien binaire sur un schéma hébergé reste une preuve de livraison distincte.

Les tests ciblés sont `tests/unit/outgoing*.test.ts`, la régression stockage et `node scripts/e2e.mjs --integration-only --integration-file=tests/integration/outgoing.test.ts`. Le banc impose marqueur propriétaire, base locale dédiée et S3 local ; son reçu prouve sa préservation/nettoyage. La mesure de 20 Mio utilise un seam de validation de format synthétique pour éprouver stockage/transport et non un nouveau qualificatif de format. Les tests UI/E2E, la revue indépendante du candidat et les GO de livraison sont distincts.

Le contrôle local du 18 octobre a retenu trois assemblages de 20 Mio avant le marqueur, avec deux expirations/réadmissions puis reprise des anciens workers. Trente plages S3 ont été lues ; les deux anciens workers ont été clôturés sans appel ni mutation du slot courant, et le troisième a effectué un unique appel simulé. Delta RSS maximal échantillonné : 219 836 416 octets, RSS échantillonné total : 534 204 416 octets, dans un seul processus de test. Ces échantillons ne prouvent ni un pic absolu, ni la libération physique immédiate, ni une borne globale pour des instances hébergées ou davantage de suspensions. Les preuves JSON locales et le reçu du banc conservent cette réserve ; les plafonds globaux cinq intentions par heure et par jour réduisent l'exposition sans transformer cette mesure en garantie.
