# 0002 — Connexion et dossiers persistants

Date : 3 octobre 2026. Périmètre : Issue #17, première tranche du parcours #20.

## Décision

Next.js héberge les routes serveur ; PostgreSQL conserve les comptes Better Auth,
l'admission familiale, les sessions et les dossiers. Le rôle global ne donne aucun
droit sur un dossier. Le créateur reçoit sept attributions explicites dans la même
transaction que le dossier. Renommer exige Consulter + Modifier et une version
attendue ; un conflit ne remplace pas le travail concurrent.

L'inscription publique est fermée. Seules les routes de connexion et déconnexion
sont exposées par Better Auth ; l'application ne propose ni création de compte,
ni invitation, ni récupération de mot de passe dans cette tranche. Les sessions
expirent après 12 heures au maximum et 30 minutes sans opération applicative.
Les vérifications périodiques de session ne prolongent pas cette durée.

Les routes relisent l'admission, la session et les attributions en base. Une
suppression/réadmission doit incrémenter l'epoch du membre pour invalider ses
anciennes sessions. Les opérations maintiennent le verrou d'admission jusqu'au
commit. Le changement d'état d'un membre n'est pas une fonctionnalité UI de #17.

La page `/` reprend le hand-off Documents validé du 3 octobre. Le composant de
l'ancienne démonstration et ses tests métier restent conservés ; ses scénarios
navigateur sont archivés sous `tests/historical`. Les actions de dépôt/partage
sont désactivées tant que les tranches #18 et #19 ne sont pas qualifiées.

## Configuration et qualification locale

Variables serveur : `DATABASE_URL`, `AUTH_SECRET` (32 caractères minimum),
`AUTH_BASE_URL` (origine exacte), `HESTIA_ENVIRONMENT` (`local`, `dev`, `production`).
Le mode local exige des hôtes loopback ; les environnements hébergés exigent HTTPS.
Aucune valeur privée ni compte familial n'est fourni dans le dépôt.

Les migrations sont explicites : `migrateDatabase(pool, config)` initialise le
schéma Better Auth de la version verrouillée et applique les migrations SQL
versionnées sous verrou avec contrôle d'empreinte. Elles ne s'exécutent jamais
sur une requête web. `provisionSyntheticMember` est réservé à une base locale
`hestia_test_*` et des adresses `.invalid` ; ce n'est pas un outil de provisionnement
Production.

Avec Node 24 et Docker disponibles :

```sh
npm ci --ignore-scripts
npm run build
npm run test:e2e
```

Le dernier script crée son propre PostgreSQL 17, exécute les tests SQL puis le
parcours navigateur desktop/mobile et supprime ses seules ressources. Il ignore
les connexions ambiantes et n'utilise pas Dev. L'image PostgreSQL est identifiée
par son SHA dans `tests/helpers/with-postgres.mjs` et doit être disponible localement.
`node tests/helpers/with-postgres.mjs --integration-only` exécute les contrôles SQL.
Les reçus minimisés sous `artifacts/pg-runs` prouvent le nettoyage du banc ; les
traces navigateur contenant potentiellement des cookies sont désactivées.

## Limites de cette tranche

La qualification locale ne prouve ni un déploiement Vercel, ni l'accès Neon,
ni une caméra physique. Le stockage des fichiers, le partage, la corbeille et
le provisionnement Dev sont traités par les Issues suivantes. Le fichier Compose
fournit seulement une base locale jetable ; le
pilote ci-dessus est le chemin de test qualifié. Aucun service Production n'est
créé ou autorisé par cette décision.
