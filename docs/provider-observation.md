# Observation des invocations IA

La migration019 ajoute `hestia_provider_invocation_observation`, sans modifier les colonnes ou les anciennes lignes de `hestia_classification_request`. Aucun backfill n'est réalisé.

Chaque nouvelle invocation des adaptateurs résumé, Inbox, Capture ou vérification peut produire une observation liée au `request_id` comptable local. Le cache et les commandes idempotentes ne créent pas une nouvelle mesure. La vérification utilise `operation='check'` et ne qualifie pas les parcours Native.

`basis='SERVER_PROVIDER_INVOCATION_MONOTONIC'`, `clock='NODE_HRTIME'` et `measurement_version=1` décrivent la durée observée côté serveur, immédiatement avant l'appel de l'adaptateur jusqu'au premier résultat, rejet ou timeout. Cette durée inclut la préparation/transport/lecture/normalisation à l'intérieur de l'adaptateur ; elle exclut la réservation SQL, la projection métier, le règlement et le polling client. Elle ne mesure pas la génération pure chez le fournisseur.

Deux échantillons `process.hrtime.bigint()` donnent `elapsed_us`, arrondi vers le haut à la microseconde. Une horloge invalide, régressive ou une durée non représentable donne `measurement_status='CLOCK_INVALID'` et `elapsed_us=NULL`. Une durée observée supérieure à25000ms reste telle quelle. Le timeout existant demeure25000ms par défaut ; un timer Node retardé ne constitue pas une garantie de terminaison distante. Le premier événement est conservé et une réponse tardive après timeout ne modifie ni observation ni règlement.

L'écriture technique intervient après la confirmation de la transaction financière/métier, dans une transaction distincte : acquisition limitée à500ms, verrou SQL250ms et chaque statement500ms. Une acquisition tardive est libérée/détruite sans requête. Une erreur de cette écriture n'affecte pas le résultat métier ou le coût déjà confirmé, et ne déclenche aucun nouvel appel. La clé primaire interdit le remplacement d'une observation. Le constructeur Summary accepte le Pool existant en troisième argument ; l'application le transmet. Les anciens consommateurs de ce constructeur sans Pool restent compatibles, mais ne persistent aucune observation.

Une mesure absente (crash entre commits, échec de persistance ou ancienne émission) signifie **non mesurée**. Elle ne signifie jamais zéro, succès ou timeout. `recorded_at` est la date SQL de l'enregistrement, pas l'horloge de durée. Aucun contenu, credential, URL fournisseur ni message d'erreur libre n'est enregistré.

La nouvelle instrumentation ne requalifie pas l'ancienne campagne cbf : ses sept PASS, le STOP WebP, son coût6146µEUR et son intervalle DB26726ms restent inchangés. Toute qualification prospective doit lier la nouvelle source et lire l'observation exacte, en distinguant cette durée, l'intervalle DB et les observations client. Aucun nouveau verdict Dev, Native ou Browser n'est acquis par les tests locaux.

Impact Browser Use : aucun écran, DTO public, parcours ou critère fonctionnel modifié. Les fiches restent inchangées ; leur exécution et la qualification prospective restent séparées.
