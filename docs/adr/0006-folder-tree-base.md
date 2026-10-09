# ADR-0006 — Sous-dossiers et politique d’accès commune

8 octobre 2026. Implémentation locale de l’Issue #38, issue de l’étude ADR-0005. Ce document ne constitue ni une preuve de déploiement, ni la livraison des déplacements (#39) ou de la corbeille de dossiers (#40).

## Placement et autorités

La migration additive 008 conserve les dossiers existants comme racines et ajoute une relation `parent_folder_id`. La création d’un enfant exige Consulter et Modifier sur le parent dans la transaction qui crée le dossier. Elle n’insère aucun grant pour son créateur. Les sept grants initiaux restent réservés à la création d’une racine. Le créateur et l’imputation des originaux ne changent pas.

Le moteur serveur distingue le placement courant, les dépendances immuables des délégations et les références de gestion. Tous les lecteurs documentaires, partages et opérations de gestion utilisent le même graphe. Les enveloppes, restrictions, échéances et epochs sont vérifiées sur chaque chaîne ; un droit indépendant valide n’est pas supprimé avec une autre source. Une restriction s’applique aussi aux capacités transmises par les intermédiaires, aux lieux d’émission et au dossier concerné.

Une référence héritée autorise des partages dépendants ; elle ne crée pas implicitement de droits directs. Sa transmission explicite dans un enfant crée une attestation locale et coupe uniquement l’ancienne chaîne de gestion dans ce sous-arbre. Cette coupure suit les remplacements successifs de la même référence ; l’ancre historique du nouveau cadre autonome n’est pas une dépendance. Le parent, les frères et les références autonomes imbriquées sont préservés. Le nominé doit rester lecteur et pouvoir effectivement exercer la nouvelle référence, y compris dans les descendants concernés. La succession conserve les bornes de l’attestation et ne donne aucun droit documentaire à l’administrateur du foyer. L’empreinte de confirmation inclut les effets par dossier, membre et capacité ; une échéance atteinte depuis l’aperçu impose de le renouveler.

## Noms, transactions et reprise

La comparaison des noms emploie une seule fonction JavaScript, également utilisée pour le backfill : trim, NFC puis casse ignorée ; les accents et espaces intérieurs restent significatifs. Le nom affiché historique est conservé. Les nouvelles collisions entre frères sont refusées sous le verrou de politique ; les collisions de racines sont limitées au créateur. Les homonymes historiques ne sont ni renommés ni fusionnés. Il n’y a donc pas d’index unique naïf sur toutes les lignes anciennes.

Le verrou de politique `480519001` précède les lignes et couvre les writers de dossiers, grants, restrictions et membres. Les contrôles de cycles sont également présents en SQL. Création et renommage conservent un reçu durable lié à l’acteur, à son epoch et à l’empreinte de l’intention. Le client conserve la clé en cas de réponse incertaine et vérifie le reçu avant une nouvelle tentative. Un reçu ne redonne jamais l’accès à une cible devenue inaccessible.

Les limites techniques refusent intégralement une opération trop importante ; elles ne tronquent pas silencieusement un arbre et ne fixent pas un nombre métier de niveaux. Le chargement est borné à 10 000 dossiers et coupures de gestion, 50 000 grants et restrictions, avec un budget de calcul de 1 000 000 opérations par évaluation. Les writers vérifient la capacité ajoutée avant validation de leur transaction. La liste et le détail partagent une évaluation chargée sous le même verrou. Ces limites conservatrices demandent une nouvelle mesure avant tout relèvement.

## Projections et interface

L’inventaire envoyé au navigateur ne contient que les dossiers consultables. Les identifiants de parents et le fil d’Ariane sont coupés au premier ancêtre non consultable ; un partage isolé apparaît comme une entrée accessible. Les compteurs portent sur les enfants directs visibles et les documents actifs. Les origines de droits privées restent opaques. Le serveur fournit les combinaisons transmissibles par une seule autorité ; le navigateur ne les déduit pas d’une union de capacités.

L’interface intègre le hand-off arborescence V2 validé, archive SHA-256 `99e1ff0bd8589cc7ed719b1fcb32293cc4f4ff774cf43ef4dadfc584468b192b`, Clé de voûte 1.0 et extension 1.3. Le prototype de design ne sert jamais de moteur d’autorisation. Les actions de déplacement et de corbeille de dossiers attendent leurs tranches respectives ; la corbeille documentaire existante est conservée.

## Migration et preuve de récupération

Le backfill et le passage à NOT NULL sont atomiques ; les événements de contraintes différées sont vérifiés avant le changement de définition de colonne. Les anciennes migrations gardent leurs checksums. Avant une future mise en service, arrêter les anciennes instances et effectuer une sauvegarde cohérente : une application qui ignore l’arbre ne doit pas continuer à écrire son schéma plat. Aucun retour destructif au schéma plat après création d’enfants n’est prévu ; restaurer une sauvegarde cohérente ou appliquer un correctif en avant.

Les contrôles locaux couvrent les requêtes HTTP sous sessions synthétiques, les transactions PostgreSQL et les octets sur un stockage S3 local privé. La récupération emploie pg_dump/psql sur un schéma exclusivement synthétique construit avec les migrations produit, puis un schéma cible neuf et un stockage cible distinct : identités, références, délégations, coupures, restrictions, reçus, métadonnées, quotas et empreintes des originaux sont comparés ; les droits sont évalués à l’heure de restauration. Une ancre historique désormais révoquée est restaurée comme donnée, pas rejouée comme nouvelle commande de transfert. Cet exercice n’implémente pas l’export complet du foyer (#10) et n’exporte aucun compte d’authentification, session ou secret.

Les résultats et limites du candidat exact résident dans les preuves de vérification et de revue. Les tests locaux, y compris le navigateur automatisé, ne constituent ni une recette Browser Use Dev ni une acceptation utilisateur sur téléphone physique.
