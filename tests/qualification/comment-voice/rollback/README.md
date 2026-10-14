# Répétition locale N → N−1 → N

Ce banc est explicite et ne fait partie d'aucun déclenchement CI ou déploiement.
Le coordinateur réserve le port3210 et un runtime PostgreSQL/S3 synthétique,
exclusif et jetable. Aucune recette Browser Use ni qualification fournisseur.

La version ancienne est exactement `6c466c54ee3c1a42ad78e41fc328fa5b5b1015c8`.
L'opérateur local conservé dans `artifacts/qualification/comment-voice/rollback/`
fige et relie les sources, les deux builds standalone effectifs, leurs reçus
de construction, chaque PID et les trois phases. Il arrête une application avant
de lancer la suivante. Les credentials générés restent uniquement en mémoire ;
les sorties des enfants sont filtrées. L'exécution attend la revue indépendante
de ses fichiers et la libération du port par la campagne principale.

1. Créer la base vide avec marqueur exact du runtime. Le bootstrap **N−1** réel
   applique les migrations001–013 et crée les deux utilisateurs synthétiques.
2. Le test `migration.test.ts` applique **N** : migrations014–015 additives,
   checksums historiques et membres inchangés, STT désactivé sans credential.
3. Démarrer **N** et exécuter `rehearse.mjs --phase prime` : trois imports PNG
   synthétiques, commentaires sauvegardés par API, vrais objets S3 vérifiés par
   SHA. Les cas `keep`, `abandon` et `finalize` reçoivent des résultats de
   classement et coûts connus/inconnus synthétiques injectés explicitement en
   SQL. Un reçu STT de coût inconnu est injecté sans audio, texte ni appel réseau.
4. Arrêter **N**, démarrer **N−1**, exécuter `--phase legacy` : DTO de l'ancienne
   version, abandon par DELETE réel, finalisation par preview/confirmation réelles.
   Après chaque clôture, vérifier en SQL commentaire vide et identité, catalogue,
   résultat de classement purgés ; coûts connus/inconnus inchangés. Vérifier les
   octets sources S3 des trois préparations.
5. Arrêter **N−1**, réappliquer les migrations **N** sans perte de lignes, puis
   redémarrer exactement le build **N** figé. `--phase return` vérifie la reprise
   du commentaire conservé, sa modification sans nouvelle version de pixels ni
   prolongation d'échéance, la purge des fermés, la conservation des coûts et du
   document final ainsi que son original S3. La dictée demeure indisponible.
6. Le propriétaire arrête ses seuls processus et supprime ses seules ressources
   Docker étiquetées après vérification d'identité, puis contrôle la conservation
   des services préexistants. Les reçus et les échecs restent conservés.

Chaque phase exige un nouveau `--out`, le reçu précédent applicable via
`--previous`, et un `--binding` contenant l'identité du runtime réellement lancé.
Un reçu est écrit RUNNING avant les effets ; un résultat ambigu produit FAIL
sans relance automatique. Les accès SQL et S3 du scénario sont bornés aux IDs
créés par ses propres reçus. Le script ne lance aucune maintenance globale.

Le test vérifie la purge applicative immédiate du commentaire et des analyses,
pas une purge physique globale des objets temporaires. Les comptabilités sont
des fixtures de contrat : elles ne prouvent ni une facturation fournisseur réelle
ni l'efficacité de sa rétention. Les trois PASS et le reçu de provenance/nettoyage
doivent être rapprochés ; une phase seule ne qualifie pas le retour arrière.
