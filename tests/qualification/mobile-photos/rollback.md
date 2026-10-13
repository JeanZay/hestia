# Répétition N → N-1 → N

Ne lancer que dans la fenêtre exclusive orchestrée par root. Ce scénario vérifie HTTP, DB et vrais objets ensemble ; aucune phase n’est exécutée implicitement par l’import d’un module ou la CI.

Conserver le même runtime PostgreSQL/S3 synthétique et les mêmes données entre trois applications, en arrêtant une application avant de lancer l’autre. N applique013 via le provisioning explicite. N-1 utilise l’archive exacte d8caeaff941de1d563fa65baba06dd20e3aa2b96 avec ses migrations001–012 intactes ; conserver le schéma additif013. Root lie chaque processus/build à son archive, son port3210 et son runtime dans un reçu séparé. Un HEAD du checkout ne prouve pas le code du processus.

Depuis le nouveau worktree, avec les variables de son runtime synthétique en mémoire, appeler successivement le même script figé :

```text
node tests/qualification/mobile-photos/rollback.mjs --phase prime --out artifacts/rollback/prime.json
node tests/qualification/mobile-photos/rollback.mjs --phase legacy --previous artifacts/rollback/prime.json --out artifacts/rollback/legacy.json
node tests/qualification/mobile-photos/rollback.mjs --phase return --previous artifacts/rollback/legacy.json --out artifacts/rollback/return.json
```

Les changements d’application se font entre les commandes. Le script crée uniquement son brouillon synthétique et ses images ; il ne supprime ni schéma, ni originaux, ni données d’un autre essai. Le bootstrap jetable est nettoyé ensuite par le propriétaire du runtime, avec son inventaire habituel. Les mots de passe/cookies ne sont jamais consignés.

La révision5 préinscrit quatre scénarios et leurs intentions avant les écritures. Elle journalise les IDs reçus et les sources réservées au fur et à mesure. La destination existante est refusée avant tout HTTP. Les reçus intermédiaires `RUNNING` et les échecs restent exploitables pour réconciliation ; ils n'autorisent aucune répétition automatique d'une écriture incertaine.

| Scénario | N prime | N-1 réel | Retour N |
| --- | --- | --- | --- |
| `adjust` | Une page2400×1800, deux dérivées et aperçu legacy | PATCH avec title/format lus : rotation90°, crop gauche10% | Dérivées640/1600 au ratio1620/2400 et SHA différents ; ancienne version409 ; legacy inchangé |
| `replace` | Une page et ses deux dérivées | Réservation/chunks/complete avec replacePageId et nouvelle source1800×2400 distincte | Uniquement le nouvelID ; dérivées différentes ; ancienID404 |
| `remove` | Deux sources distinctes et leurs dérivées | PATCH du manifeste ne conservant que la seconde page | Page retirée404 ; survivante et ses deux SHA de dérivées identiques |
| `abandon` | Une source et ses deux dérivées | DELETE Capture avec version courante | Lecture capture et ancienne dérivée410 |

Chaque entrée `receipt.scenarios.*` contient `capture.id`, son état/version, `sources:[{pageId,sha256,size,width,height,...}]`, ainsi que les empreintes des dérivées prime et retour. Les sources anciennes et nouvelles restent listées après remplacement. `replace.oldPageId/newPageId` et `remove.removedId/survivorId` identifient les attentes de statut. Les clés S3 ne sont pas exposées par l'API : l'opérateur les rapproche par une requête DB en lecture seule, **limitée à ces quatre capture.id**. Il peut ainsi vérifier les octets des sources `saved`, les objets des pages retirées/abandonnées et la comptabilité des dérivées, sans parcourir d'autres captures. Le DTO ne prouve pas à lui seul le SHA d'une source ; la répétition HTTP le signale explicitement.

Le contrôle SQL/S3 de l'opérateur, puis la maintenance N éventuellement autorisée sur ce runtime entièrement possédé, complètent les assertions de quota/purge et de protection des sources. Aucune maintenance n'est déclenchée par ce script. Un résultat de phase sans preuve des trois builds exécutés, ni ces contrôles de stockage, n'est pas un PASS complet PH4/PH8.
