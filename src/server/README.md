# Serveur Hestia : tranche connexion et dossiers

Configuration obligatoire : `DATABASE_URL`, `AUTH_SECRET` (au moins 32 caractères),
`AUTH_BASE_URL` (origine exacte, sans slash final), `HESTIA_ENVIRONMENT`
(`local`, `dev`, `production`). Local exige PostgreSQL et application sur loopback ;
les origines hébergées exigent HTTPS. Aucun secret de secours ni migration au démarrage.

`readServerConfig()` valide cette configuration. `createApplication(pool, config)`
expose les handlers employés à la fois par les routes Next et les tests SQL.
L'instance Next garde seulement un pool et la configuration ; les admissions,
sessions et capacités sont relues depuis PostgreSQL à chaque action.

`migrateDatabase(pool, config)` est une opération explicite : migrations Better Auth
de la version verrouillée, puis migrations SQL Hestia numérotées et vérifiées par
empreinte. Une migration déjà appliquée dont les octets changent est refusée.
La coordination des migrations doit être unique avant de démarrer les instances.

`provisionSyntheticMember(pool, { email, name, password, role?, active? })` est réservé
au banc local : nom de base `hestia_test_*`, connexion loopback et adresse `.invalid`.
Il crée atomiquement l'identité vérifiée, le compte de connexion et l'admission.
Il ne constitue ni un endpoint public ni un mécanisme de provisioning familial.

Les seuls endpoints Better Auth exposés sont POST `sign-in/email` et `sign-out`.
Les mutations exigent l'origine configurée. L'API Hestia expose GET `session`,
GET/POST `folders` et PATCH `folders/[id]`. Ses erreurs ont la forme
`{ error: { code, message } }`. Une panne produit 503, jamais une liste vide.

Les sessions ont une limite absolue de 12 h et une inactivité de 30 min, contrôlées
dans la base, sans cache cookie. Le polling GET `session` ne prolonge pas l'activité.
Une révocation d'admission doit verrouiller la ligne `hestia_member` et incrémenter
son `epoch` : les anciennes sessions ne redeviennent pas valides après réadmission.
Les opérations prennent ce verrou puis celui de la session jusqu'à leur commit.
Pour renommer, elles prennent ensuite celui du dossier et exigent les capacités
actuelles `consulter` et `modifier`, puis la version attendue.

Le schéma de cette tranche contient uniquement des attributions directes et la
référence d'administration locale du créateur. Les sept capacités sont indépendantes.
Le rôle global n'entre jamais dans le calcul de lecture. Aucun endpoint de partage,
administration de membre, dépôt documentaire ou export n'est encore exposé.
Le développement du partage devra étendre les migrations et le validateur de droits
avec la filiation et les enveloppes déjà spécifiées ; une référence seule ne transmet
aucune capacité par l'API de cette tranche.
