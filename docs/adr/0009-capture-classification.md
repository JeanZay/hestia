# ADR 0009 — Capture privée et classement confirmé

Date : 10 octobre 2026. Périmètre : implémentation et qualification locales sur données synthétiques.

## Original et temporaires

Un import conserve ses octets exacts. Une capture caméra permet les ajustements manuels avant de produire son original : image pour une page si choisie, ou PDF. Le fichier final validé devient l'original immuable ; les sources ne constituent pas un album documentaire durable.

Le brouillon caméra appartient exclusivement à son auteur et à son admission courante dans le foyer. Il expire sept jours après sa création, sans prolongation lors des sauvegardes. Seules les pages dont la sauvegarde a été confirmée sont récupérables. Un import utilise une copie transitoire bornée à une heure, sans promesse de reprise à sept jours.

Le manifeste versionné lie l'ordre, la rotation et le recadrage de chaque page au fichier préparé. Toute modification invalide l'analyse et la confirmation de la version précédente. Les rendus passent par un processus jetable, sans les secrets applicatifs, avec des bornes de temps, pixels, pages et octets. La limite de tas JavaScript ne constitue pas une limite de mémoire résidente : les mesures du corpus synthétique font partie de la qualification.

## Placement et droits

Le classement reste manuel ou assisté au choix de l'auteur. La navigation manuelle est présentée d'abord, puis le dossier courant lorsqu'il est autorisé, les suggestions existantes et les chemins nouveaux. Le serveur vérifie consulter et déposer ; créer des enfants exige également modifier sur le parent. Le nouveau chemin hérite des droits, sans octroyer de pouvoir supplémentaire au créateur.

L'aperçu ne révèle les personnes que dans l'enveloppe de partage ou d'administration déjà autorisée. Sinon, il expose les capacités propres et une information neutre. La confirmation utilise un jeton opaque ; aucune signature du graphe privé n'est envoyée au client. Les droits, l'admission, l'échéance, le manifeste et la destination sont recontrôlés après les opérations de stockage.

La finalisation crée les dossiers, le document et son reçu dans une transaction unique. Une clé d'idempotence lie les entrées exactes à un résultat unique ; la perte de réponse appelle une réconciliation avant une nouvelle tentative. Le reçu ne ressuscite pas un document supprimé et ne contourne pas une révocation.

## Stockage et suppression

Les réservations et objets Capture rejoignent le budget sérialisé des documents existants. Sources, copies en préparation et suppressions échouées restent comptabilisées. Un échec ne libère pas artificiellement l'espace. Un verrou d'opération partagé empêche le nettoyeur de supprimer un objet dont l'écriture est encore en cours.

La promotion crée les lignes du registre documentaire existant (`hestia_upload`, `hestia_upload_object`, `hestia_document`). La suppression, la corbeille, les déplacements et le téléchargement continuent ainsi à utiliser les mêmes contrôles. Les sources deviennent purgeables après le commit durable du document ; un échec de purge ne fait pas perdre le final.

Une sauvegarde documentaire doit sélectionner les seuls originaux publiés depuis le registre des documents, jamais l'ensemble d'un préfixe de stockage. Les brouillons et rendus sont exclus. Les tests d'export/restauration synthétiques ne prouvent pas la configuration d'une sauvegarde distante.

## Suggestions et budget

L'analyse est déclenchée explicitement, document par document. Elle transmet uniquement le fichier préparé choisi et les libellés des dossiers actuellement consultables et déposables. Les ancêtres invisibles, lecteurs et autres documents sont exclus. Le contenu documentaire et la réponse du modèle sont des données non fiables, sans pouvoir d'outil ni écriture autonome.

Le Propriétaire et les Administrateurs actifs peuvent gérer la configuration commune. Ce rôle ne donne aucun accès supplémentaire aux documents ou brouillons. La clé est chiffrée côté serveur et ne peut pas être relue par le client. Enregistrer la configuration ne déclenche aucun appel fournisseur.

Le plafond est mensuel, en euros, comptabilisé en millionièmes d'euro entiers sur un mois civil UTC. Un appel réserve sa borne maximale avant émission. Les appels en cours restent imputés à leur mois initial ; un coût inconnu conserve sa réservation, même après changement de mois. Aucune nouvelle tentative facturable n'est automatique. Une baisse de plafond ne supprime ni dépenses ni réservations.

Un fournisseur sans modèle, format ou tarif borné et qualifié ne peut pas émettre d'analyse. Aucun prix ou taux de conversion n'est déduit du nom d'un modèle. Les fournisseurs réels restent désactivés par défaut ; la qualification locale utilise une injection synthétique. L'activation réelle, ses clés et sa dépense relèvent d'une qualification et d'une autorisation distinctes.

## Design et portée des preuves

L'intégration suit Capture v1 et les composants validés du Design System 1.4. Les détails techniques corrigent les divergences du prototype avec les droits existants, la période mensuelle et les rôles explicitement retenus ; ils ne créent pas une nouvelle interface.

Les fichiers injectés dans Playwright qualifient le parcours synthétique. Ils ne prouvent pas la caméra physique sur iOS ou Android, les performances d'un hébergement distant, un effacement physique chez un fournisseur, ni l'exécution d'un modèle réel. Ces limites doivent rester visibles lors de la livraison Dev autorisée.
