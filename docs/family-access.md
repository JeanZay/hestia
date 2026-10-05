# Accès du foyer

Les parcours d’installation, d’invitation, de récupération et de retour utilisent
des preuves privées à durée limitée. Le propriétaire et les administrateurs
gèrent les membres ; leur rôle ne donne aucun accès implicite aux documents.
La conception des écrans vient du hand-off Claude Design Accès familiaux v4.

## Développement et vérification

Les migrations `005-family-members` et `006-family-identity` sont additives.
Elles s’exécutent par le provisionnement explicite existant, jamais lors d’une
requête web. La migration vérifie les références de gestion historiques avant
de les reprendre ; une incohérence interrompt la transaction au lieu de créer
des droits supposés. Un retrait conserve les documents et leur auteur.

Le banc `node scripts/e2e.mjs --integration-only` utilise PostgreSQL et le
stockage objet locaux éphémères. Il teste les règles et les transitions avec
Better Auth réel. Après `npm run build`, `npm run test:e2e` ajoute les parcours
navigateur sur ordinateur et mobile. Le collecteur de messages des tests reste
dans le processus de test : aucune route permettant de lire un OTP n’est
exposée par l’application. `npm run verify` rassemble les contrôles de livraison.

## Installation et secours opérateur

L’opérateur disposant des accès de déploiement utilise explicitement
`node scripts/identity-operator.mjs bootstrap` avec un objet JSON contenant
`email` et `name` sur l’entrée standard. La commande refuse une instance déjà
initialisée. Elle prépare un lien personnel ; seul son destinataire peut
vérifier l’adresse, choisir le mot de passe et confirmer la conservation de ses
huit codes de secours avant activation.

Le secours exceptionnel passe par
`node scripts/identity-operator.mjs exceptional-recovery`, avec `memberId`,
`email` et `humanVerificationAcknowledged: true` sur l’entrée standard. Cette
attestation ne vérifie pas une identité humaine à la place de l’opérateur : il
doit l’avoir contrôlée séparément. Ce pouvoir n’est pas une action d’un
administrateur du foyer et n’a pas de route HTTP. Un membre retiré ne peut pas
être réactivé par récupération.

Les commandes ne journalisent ni lien privé, ni OTP, ni mot de passe. Elles
préparent l’envoi dans l’outbox chiffrée et retournent seulement une référence
technique. Ne pas passer de données privées en arguments shell ni les conserver
dans le dépôt.

## Prérequis avant une recette distante

Le transport Resend utilise l’outbox chiffrée et une clé d’idempotence stable
par message. Il reste désactivé par défaut, notamment en local. Les opérations
d’identité et d’invitation réussies déclenchent un traitement borné après la
réponse ; une route interne protégée et une commande opérateur permettent la
reprise. La configuration, les limites et la planification Dev sont décrites
dans [l’exploitation des courriels familiaux](operations/family-mail.md).

Un état `sent` signifie que le fournisseur a accepté l’envoi, pas que le
destinataire l’a reçu. Une preuve expirée ou révoquée au dernier contrôle
n’est pas envoyée ; une annulation après le départ réseau ne peut pas rappeler
le courriel, mais son lien ou code devient inutilisable. Le déclenchement
après réponse et les essais locaux ne prouvent aucune délivrabilité distante.

Avant de proposer ces parcours sur Dev, vérifier le transport, le déclencheur,
la délivrabilité et la procédure de secours opérateur. Les essais locaux ne
prouvent aucun de ces éléments. Une promotion Production exige la recette Dev
et le GO applicable sur le candidat exact.

## Invariants à conserver

- Une simple demande de récupération ne coupe aucune session. La preuve valide
  engage une récupération persistante, invalide l’ancien secret et ferme les
  sessions. Une interruption ne réhabilite pas l’ancien mot de passe.
- Après récupération, les anciens codes sont invalidés et le compteur vaut
  zéro. Le titulaire se reconnecte puis renouvelle ses codes depuis Moi.
- Le retour d’un membre est explicite et exige une nouvelle activation. Il
  revient comme membre, sans ses anciens accès ni son ancien rôle administrateur.
- Une transmission de gestion conserve l’enveloppe et l’échéance existantes.
  Elle ne crée aucun droit de lecture ; le destinataire doit rester lecteur
  après les révocations réellement entraînées par la transmission.
- Le retrait est possible sans successeur immédiat. Un administrateur peut
  traiter un dossier sans gestionnaire par sa référence neutre, sans voir son
  titre ou son contenu s’il n’en est pas lecteur.

L’administration générale des rôles, le transfert du propriétaire et les
sous-dossiers restent des besoins distincts de ce parcours.
