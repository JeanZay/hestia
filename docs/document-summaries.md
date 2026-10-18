# Résumés des documents

Un résumé décrit uniquement l’original en une phrase française de 200 caractères Unicode au maximum. Le fournisseur reçoit les octets et le type de média : aucun titre, nom de fichier, chemin, commentaire ou contexte privé du mail. Le résumé reste attaché au contenu immuable de sa version. Ce repère n’est pas une vérification du document.

Les nouveaux imports, captures caméra et pièces jointes mail utilisent la même file. Les contenus courants anciens sans résumé sont admis progressivement par le travail serveur existant : au plus 100 admissions par passage, ordonnées par ancienneté puis identifiant, avec insertion idempotente. Les anciennes versions ne sont pas toutes analysées ; une version restaurée comme courante peut être admise. Un résultat conservé pour ce contenu est réutilisé.

## Conditions de traitement

L’admission reste soumise aux droits actuels du propriétaire, au consentement existant, au profil de résumé qualifié, à l’activation propre à l’environnement et au plafond IA partagé avec le classement. Les plafonds et fournisseurs existants ne sont pas élargis. La disponibilité du classement ne prouve pas celle du profil de résumé : le runtime actuel exige les activations et profils de classement et de résumé. Leur qualification sur un environnement durable reste une étape distincte.

Le batch conserve sa limite de 1 à 10 travaux et son budget maximal de 35 secondes ; la maintenance en demande au plus 4. Une rotation conservée en base alterne la priorité entre nouveaux résumés, suggestions privées et rattrapage, y compris quand une seule tâche tient dans un passage. L’admission ne lit aucun objet et ne contacte pas le fournisseur. Le traitement conserve la limite de 20 Mio et dix plages au plus de 2 Mio.

Un refus temporaire **avant toute réservation et tout envoi** reste en attente interne, avec un nouvel examen au plus tôt 60 secondes après. Cela permet notamment de reprendre après activation/configuration, retour du budget ou indisponibilité temporaire de l’objet. Les refus de droits sont également différés avant toute lecture de l’objet. Le curseur partagé et les échéances évitent qu’un stock ancien ou un refus répété occupe toujours le premier créneau. Aucun délai d’achèvement n’est garanti.

Un appel possiblement envoyé n’est pas repris automatiquement. Son coût inconnu reste réservé, même après changement de mois. Les anciens états terminaux sans preuve d’absence d’envoi restent inchangés. Les lignes `permitted=false` et l’annulation de l’analyse automatique mail sont préservées, y compris après rangement. Une ligne de résumé manquante avec un reçu financier antérieur est exclue du rattrapage et nécessite une réconciliation ; l’absence de ligne ne prouve pas l’absence d’envoi.

## Présentation et lecture

Les listes, la recherche, À classer, la fiche et les versions partagent la projection serveur. L’absence de ligne est `none`, un travail programmé `pending` (présenté « Résumé prévu »), puis `running` ou `ready`. Un travail temporairement différé est présenté indisponible ; les métadonnées internes de reprise ne sont pas exposées. Une cause apparaît seulement si elle est établie : réglage commun désactivé, refus du plafond du foyer, ou réponse valide `summary:null` avec coût connu et admis. Un plafond de déploiement plus bas ou un profil absent ne prouvent pas que le plafond du foyer est atteint. Aucun diagnostic de format n’est inventé depuis une cotation refusée.

Afficher ou rafraîchir un document n’admet aucune tâche et ne déclenche aucune analyse. Le GET de l’espace de travail revalide les droits et fournit uniquement le résumé courant. La recherche conserve son périmètre titres, noms de fichiers et dossiers ; elle n’indexe pas les résumés. La correspondance des composants avec les sources Claude est décrite dans [le dossier de design](design/document-summaries-correspondence.md).

## Migration et retour arrière

La migration `020-systematic-summaries` ajoute trois métadonnées au résumé, des index et une ligne de rotation. Elle n’admet aucun ancien document, ne modifie aucun original ou résultat existant et n’effectue aucun appel externe. Les migrations 001 à 019 conservent leurs octets et checksums. L’exécution est une opération explicite de provisioning ; aucune migration n’est lancée par une lecture web.

Le retour à l’application précédente peut conserver ce schéma additif : ses projections et instructions utilisent des colonnes nommées, les nouveaux index et la table de rotation n’affectent pas ses requêtes. Les tâches `pending` déjà admises restent traitables sous ses règles et plafonds ; revenir au code précédent ne les annule pas. Pour arrêter tout traitement sur un environnement, utiliser le réglage IA existant et vérifier les requêtes en cours et les réservations avant de rétablir une version. Ne supprimer ni reçu financier ni ligne de résultat pour effectuer un retour arrière. Une correction ultérieure du schéma passe par une migration additive qualifiée.

Les tests locaux utilisent exclusivement une base PostgreSQL et un stockage privés éphémères, marqués et possédés par le banc. Ils ne qualifient ni les profils d’un environnement durable, ni une génération effective sur des documents réels.
