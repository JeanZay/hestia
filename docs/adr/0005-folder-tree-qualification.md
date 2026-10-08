# ADR-0005 proposé — Arborescence, autorités et groupes de corbeille

8 octobre 2026. **Étude locale, proposition à intégrer ; aucun changement du produit.**

## Périmètre et références

Cette étude répond au brief arborescence validé et au GO « V2 validée, GO qualification technique locale ». Les accords, le brief et les preuves exactes sont conservés dans les artefacts locaux du lot ; ils ne font pas partie de ce document publiable. La validation technique ci-dessous n’accorde ni publication ni implémentation produit.

Le design de référence est Clé de voûte 1.0 et ses extensions Documents/Accès, avec le complément Documents arborescence v2. L’archive originale a pour SHA-256 `99e1ff0bd8589cc7ed719b1fcb32293cc4f4ff774cf43ef4dadfc584468b192b`. Les nouveaux détails d’effets d’accès sont conçus dans ce hand-off ; aucun écran supplémentaire n’est conçu ici.

Le résultat utilisateur visé reste : créer des sous-dossiers, déplacer dossiers/documents, hériter des droits vivants avec restrictions ciblées, supprimer un groupe pour 168 heures et restaurer exactement ce groupe. Documents à la racine virtuelle, copies, fusion, import massif et sélection multiple indépendante restent exclus.

## État effectivement observé dans le produit

Référence étudiée : main `988f182532e24d034ce54c60ebca1675018a0b78`.

| Source | État et conséquence |
|---|---|
| `src/server/db/migrations/001-folders.sql` | Dossiers sans parent ; aucune contrainte d’unicité de nom. Les dossiers existants doivent devenir des racines sans être renommés. |
| `src/server/application.ts` | Créer un dossier attribue explicitement les sept capacités au créateur. Réutiliser ce comportement pour un sous-dossier créerait des droits interdits. |
| `src/server/permissions/service.ts` | Évaluation limitée aux grants d’un seul dossier ; délégation par `parent_id`, enveloppe, expiration et epoch. Étendre le calcul sans transformer les mandats dépendants en droits directs. |
| `src/server/membership/service.ts`, migration 005 | Référence de gestion attestée, transmission/succession conservatrice et retrait de membre. Le déplacement ne doit pas devenir une transmission implicite. |
| `src/server/access.ts`, migration 003 | Transactions et triggers de politique prennent déjà le verrou `480519001` avant les lignes. Point de sérialisation local existant à conserver pour la première implémentation. |
| `src/server/documents/service.ts`, migration 004 | Corbeille et reçu de dernière action par document ; échéance de 168 heures, purge différée et quota tant que l’objet est présent. Pas de groupe de dossiers aujourd’hui. |
| ADR-0004, service documents | Original immuable et `owner_id` documentaire distincts du classement ; préserver ces champs lors d’un déplacement. |

## Proposition de représentation

Ajouter une ascendance de placement `parent_folder_id` avec FK, version et états de corbeille, sans nombre maximal métier de niveaux. Une liste d’adjacence suffit pour ce foyer ; pas de chemin de noms dénormalisé servant d’autorité. Parcourir avec détection de cycles et budget de travail borné. Un dépassement interrompt toute l’opération, sans effets partiels. Les seuils finaux et temps de réponse devront être mesurés sur l’implémentation SQL, pas inventés à partir de cette étude.

Distinguer trois relations, sans les fusionner :

1. **Placement** : détermine l’héritage courant des parents.
2. **Dépendance d’autorité** : identifiant immuable du grant/mandat ayant autorisé un partage ; indépendant du chemin visuel et conservé après déplacement.
3. **Gestion et imputation** : référence de gestion attestée et `owner_id` des octets ; aucun transfert du seul fait du rangement.

Une table de restrictions cible un membre, des capacités et un dossier d’origine, avec l’autorité habilitée qui la modifie. Elle restreint tout le sous-arbre de placement concerné. Elle ne devient pas un accord positif et ne se contourne pas par un partage ajouté plus bas. L’évaluation doit conserver la provenance des chemins d’autorité, pas seulement l’union de sept booléens.

Les grants explicites existants restent identifiables ; leurs sources et enveloppes ne sont pas réécrites. Un grant indépendant valide continue à contribuer si un autre chemin est révoqué. Les nouveaux sous-dossiers héritent sans grant créateur additionnel. Un partage local par une autorité héritée conserve une dépendance sur cette autorité, son périmètre d’émission et ses bornes ; une autorité héritée n’est jamais matérialisée comme référence autonome.

## Autorités et mouvements

Calculer les droits effectifs depuis les sources encore valides, l’activité/epoch du membre, les échéances et les restrictions applicables. L’auteur historique seul n’est pas une dépendance : préserver la sémantique actuelle des accès directs et des successions attestées. Une délégation en revanche reste dépendante de son mandat exact. Vérifier l’autorité et les restrictions du délégant dans le contexte d’émission empêche de blanchir un partage via une restriction ailleurs.

La gestion locale attestée suit le dossier sans changer de titulaire. Une gestion héritée ne devient pas une référence locale ; au retour à la racine, refuser s’il ne reste aucun cadre autonome valide. La primitive expérimentale de transmission explicite peut établir ce cadre avant l’extraction : référence locale bornée par l’enveloppe et l’échéance d’origine, nominé actif conservant Consulter après retrait de la dépendance précédente. Une coupure de gestion limitée au sous-arbre retire l’ancienne référence et ses chaînes dans ce périmètre, sans révoquer le parent ni affecter les frères. Réancrer explicitement les cadres hérités concernés, conserver les attributions indépendantes et les références autonomes imbriquées. Préserver une attestation serveur immuable de cette transmission ; aucun changement de quota ni de provenance. La succession après départ conserve les exigences actuelles de révocation et d’epoch et ne donne aucun accès documentaire à l’administrateur global. Cette représentation est une proposition technique, pas une nouvelle règle produit acquise ; l’intégration du parcours existant de transmission et son attestation SQL restent à réaliser.

Les gains/pertes par personne et par élément doivent être calculés avant la confirmation. Les exceptions et le droit de connaître les effets se vérifient sur **chaque élément concerné**, puis la capacité de transmettre/retrait dans les enveloppes pertinentes. Aucun changement d’accès : Consulter + Modifier source/destination suffisent (Déposer en plus pour un document). Un changement ne s’autorise jamais par un simple clic de confirmation.

Inclure dans l’analyse d’effet les groupes déjà en corbeille encore récupérables sous le parent déplacé : leurs droits actuels changent aussi avec l’ascendance. Ne pas modifier leurs membres ni leur échéance. Refuser globalement et sans détail privé si un effet ne peut être connu/autorisé. Les éléments expirés ne donnent pas de contenu consultable ; leurs liens techniques nécessaires à d’autres groupes sont conservés.

**Réserve T1 du hand-off** : le prototype retourne `noMgmt` avant le contrôle complet de connaissabilité et peut afficher les effets détaillés. Le futur serveur doit calculer/filtrer les droits d’information avant de produire tout DTO d’impact, y compris celui d’un refus à la racine. Utiliser l’état neutre déjà conçu. Le modèle du prototype n’est pas un moteur d’autorisation à copier.

## Transaction, aperçu et reprise

La première réalisation peut conserver le verrou de politique existant pour sérialiser la mutation d’arbre, les changements de droits/admission et le cycle de vie. Étendre le même ordre aux nouveaux writers et aux opérations qui rendent une destination indisponible. Pas d’I/O S3 sous ce verrou. Verrouiller ensuite les lignes dans un ordre déterministe ; ne jamais considérer un calcul client comme une preuve d’autorité.

L’aperçu porte une identité serveur liant acteur/epoch, demande, source/destination, membres concernés, versions et effets. Au commit : relire admission/session, horloge serveur, droits, noms et contenu sous verrou. Comparer l’aperçu ; une divergence exige une nouvelle confirmation sans appliquer de partie. Une révision globale conservatrice convient pour commencer, au prix de conflits parfois inutiles. Les expirations doivent être revérifiées même en l’absence de changement de révision.

Conserver un reçu durable par acteur et identifiant d’opération, avec empreinte de la demande et résultat minimal. Même clé avec corps différent : conflit ; même opération : réconciliation sans répéter les écritures. Après révocation/expiration, le reçu ne doit pas servir à relire des données privées ni à restaurer de nouveau. Conserver assez de tombstones pour refuser les anciens réessais après purge. Ne pas étendre une échéance en rejouant une suppression.

## Corbeille groupée

Représenter une suppression par groupe immuable : racine, date serveur, échéance, membres actifs exacts au moment de l’opération, état et identité du reçu. Marquer atomiquement dossier/sous-dossiers/documents actifs. Les nœuds déjà en corbeille gardent leur groupe et leur échéance. Chaque document conserve son original et son imputation de quota jusqu’à suppression physique confirmée.

La restauration prend exactement les membres du groupe, avant son échéance, après contrôle actuel Consulter + Supprimer sur tous. Ne recopier aucun ancien grant. Parent initial actif et accessible : restaurer à cet emplacement avec contrôle de collision. Parent indisponible : autre destination sous règles du déplacement et confirmation d’effets. La restauration individuelle d’un membre supprimé avec un groupe est refusée ; un document anciennement supprimé seul garde son parcours actuel.

Distinguer les membres à restaurer du périmètre des effets de politique : une restauration ailleurs change aussi l’ascendance des anciens groupes encore récupérables sous sa racine. Inclure ces descendants dans le calcul et l’autorisation des changements d’accès, sans les restaurer ni modifier leur échéance. Consulter + Supprimer porte sur les membres effectivement restaurés ; les autres éléments relèvent des contrôles d’information et d’effets d’accès.

Pour afficher la corbeille, filtrer chaque racine selon les droits courants Consulter + Supprimer, sans décompte de descendants non autorisés. Les groupes antérieurs ne sont ni énumérés ni comptés dans la confirmation du parent. À révocation connue, retirer les informations des vues ouvertes et recontrôler toute action serveur. Le groupe visible n’implique pas qu’on puisse le restaurer intégralement.

À `now >= deadline`, refuser récupération et contenu même si S3 n’a pas terminé. Rendre inaccessibles les métadonnées sensibles du groupe expiré, poursuivre la purge par un registre d’objets durable. Un ancien parent peut rester comme nœud technique opaque tant qu’un groupe non expiré en dépend : conserver identités/relations minimales et données de politique nécessaires sans réexposer noms/contenus ni élargir les droits. Sa disparition appelle alors une destination alternative autorisée ; ne pas supprimer en cascade le groupe encore récupérable.

## Noms, migration et sauvegarde

Clé de comparaison unique calculée côté serveur : trim de bord, NFC, casse ignorée, accents significatifs. Préserver les espaces internes ; aucune règle nouvelle de compactage. Même implémentation pour toutes les écritures et le backfill ; ne pas mélanger arbitrairement une collation PostgreSQL et un lower JavaScript. Les cas Unicode doivent avoir des tests communs avant migration produit.

Unicité entre frères actifs ; à la racine virtuelle, uniquement dans l’espace de création du membre. Les racines partagées ne forment pas un espace global de collision. Refuser sans révéler le nom d’un voisin inaccessible. Pas de suffixe automatique.

Les homonymes historiques empêchent un index unique naïf. Première migration additive : racines existantes, identités/originaux/owner_id, grants/références intacts ; backfill de la clé de nom sans renommer ni fusionner. Bloquer de nouvelles collisions et tout changement de nom/emplacement qui entretient un doublon, sous le verrou commun. Les lignes historiques inchangées restent utilisables. Un index optimisé ultérieur exige une stratégie explicite pour les doublons conservés, pas leur suppression silencieuse.

Séquence future : sauvegarde qualifiée ; vérification des versions SQL et des grants de référence ; migration additive/backfill sous mode de maintenance borné ; comparaison avant/après des identités, accès effectifs de chaque membre, objets et quotas ; mise en service coordonnée de **tous** les lecteurs et writers. Une ancienne instance applicative ignorant l’arbre ne doit pas continuer à créer des droits ou servir des liens. Pas de rollback destructif vers le schéma plat après création d’un arbre : restauration du snapshot ou correctif en avant dans le protocole prévu.

Un export cohérent inclut parents, grants et dépendances, restrictions, références de gestion, epochs, versions, groupes/membres, échéances, reçus minimaux et registre d’objets ; les octets originaux sont contrôlés par empreinte. Ne pas exporter des sessions/secrets dans un dossier produit. Rejouer une restauration synthétique dans une cible vide et contrôler droits/échéances selon l’heure actuelle, pas selon un instant gelé. L’export complet du foyer demeure un chantier distinct (#10) : le roundtrip expérimental de cette étude ne le qualifie pas.

## Preuves de l’étude et limites

Les modèles sous `tests/qualification/folder-tree/` sont des expériences isolées, jamais importées par `src/` :

- `rights-model.mjs` et `rights.test.mjs` : matrice de droits, provenance, restrictions, mouvements et refus ; analyse dans `rights-analysis.md`.
- `lifecycle-model.mjs` et `lifecycle.test.mjs` : groupes, conservation, concurrence simulée, réessais et restauration ; analyse dans `lifecycle-analysis.md`.
- `combined.test.mjs` : composition explicite des deux modèles pour les mouvements/restaurations de dossiers, dont un refus neutre du cas T1, les droits expirés et les groupes déjà supprimés. Cet adaptateur de test ne couvre pas toutes les routes ni les déplacements de documents ; il ne devient pas du code produit.
- `relational.sql` et `relational-run.mjs` : PostgreSQL local jetable, collision de nom avec deux connexions, rollback, groupes exacts, reçus, homonymes préservés, limite 168 heures et dump/restore structurel. Aucune base Hestia existante lue, aucun port publié, aucune image téléchargée. Le reçu conserve le digest de l’image locale, la suppression du seul conteneur créé et la préservation des préexistants.

Commandes depuis le worktree : `node --test tests/qualification/folder-tree/*.test.mjs` puis `node tests/qualification/folder-tree/relational-run.mjs`. Les résultats exacts et la revue sont dans les preuves locales du lot ; la présence de ce texte seule ne vaut pas PASS.

Le SQL expérimental ne contient pas le schéma complet Hestia, le calcul de droits, une migration réelle ou S3. Le test d’un marqueur périmé ne prouve pas une route de confirmation serveur. Restent à prouver sur le candidat produit : migrations complètes, concurrence multi-requêtes/horloge, propagation des révocations, limites de ressources, purge physique/reprise, droits sur tous les liens de lecture, HTTP/idempotence, recette clavier/mobile et déploiement Dev. Aucun résultat ne vaut GO Production.

## Conclusion et premier lot proposé

La séparation placement / dépendance d’autorité / gestion permet de conserver les décisions du brief sans copier durablement les droits. Les essais synthétiques éprouvent ces invariants ; leur qualification reste limitée au candidat exact et aux résultats conservés avec la revue indépendante. Aucune qualification du produit en fonctionnement n’en est déduite.

Premier lot produit recommandé après engagement distinct : **créer et parcourir un sous-dossier avec héritage vivant, sans pouvoir supplémentaire au créateur**, en conservant les racines/données actuelles et en utilisant les écrans validés. C’est une tranche verticale avec migration additive, service de droits commun, UI fidèle et tests SQL/HTTP/UI. Ses critères négatifs incluent perte d’accès, refus de création sans Modifier, collision et partage isolé sans fuite d’ancêtres. Déplacement et suppression/restauration suivront seulement après qualification de ce socle ; aucun de leurs critères n’est retiré du besoin global.

Le cadrage de l’ensemble reste nécessaire : les DTO/versions de ce premier lot doivent déjà permettre dépendances, corbeille et migration sans réinterprétation future. Cette recommandation n’est ni une Issue publiée ni un découpage détaillé des lots futurs. Les propositions Browser Use existantes restent candidates, non admises et non jouées ; cette étude ne modifie aucun parcours produit ni le catalogue.
