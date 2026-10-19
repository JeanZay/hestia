# Idées, actions et agenda familial — V1

Une fiche constitue l’unique source de la liste et de l’agenda. La liste conserve
aussi les idées sans date. L’agenda affiche une journée sous forme de liste : les
fiches sans heure ou commencées un jour précédent, puis les débuts du jour par
heure croissante. Créer depuis une journée préremplit sa date, sans imposer d’heure.
Une plage couvre tous ses jours, fin comprise pour les dates seules ; elle ne crée
ni copie quotidienne ni rappel quotidien.

Le créateur gère sa fiche. Le partage « tout le foyer » suit les membres actifs ;
un partage restreint désigne ses lecteurs. Un lecteur ne devient pas gestionnaire,
y compris s’il administre le foyer. Les filtres, catégories, décomptes et liens
directs respectent les mêmes droits que le détail.

Les fichiers restent dans le coffre. On peut associer un document existant ou
déposer un fichier dans un dossier choisi. Les droits de ce dossier s’appliquent
indépendamment de la fiche : un lecteur peut voir une pièce indisponible sans en
obtenir le titre, le nom, le chemin ni un lien de téléchargement. Dissocier ou
archiver une fiche ne supprime aucun document. Les liens web et Maps sont des
liens externes, sans carte intégrée.

## Dates et rappels

Le fuseau du foyer est `Europe/Paris`. Les jours sont des jours civils ; les heures
de rappel sont des durées écoulées. Une date seule permet des rappels en jours
avec une heure d’envoi choisie. Un rappel en heures exige une heure de début.
Lors d’un changement d’heure, un début ambigu exige le choix du passage ; une
heure inexistante, une fin ambiguë ou un rappel calculé ambigu exige un autre
horaire. Aucune interprétation silencieuse n’est appliquée.

Chaque rappel est facultatif, activé volontairement et relatif au début seulement.
Il vise individuellement le créateur et les lecteurs actifs autorisés au moment
de l’envoi, sur leur adresse vérifiée. Il contient le titre, la date et le lien
authentifié vers la fiche ; aucune pièce jointe ni description documentaire.

Changer le début recalcule les horaires et autorise un nouvel envoi pour cette
nouvelle date. Modifier seulement la fin ne recrée pas les rappels. Les nouveaux
horaires déjà passés ne sont pas rattrapés. Archiver arrête les rappels ; rouvrir
ne reprend que les horaires futurs. Après une panne, une intention déjà programmée
peut encore partir avant le début horodaté, ou jusqu’à la fin de la journée de
début lorsqu’il n’y a pas d’heure. Une plage de plusieurs jours n’étend pas ce délai.

Le départ du créateur archive ses fiches, arrête leurs rappels et fige les lecteurs
déjà autorisés. Une réadmission ne restitue pas automatiquement la gestion ou les
anciens droits. Les nouveaux membres ne découvrent pas ces archives figées.

## Exploitation

Le worker mail existant conserve la priorité des messages d’identité, puis traite
un lot borné de rappels. L’activation des rappels externes exige
`HESTIA_AGENDA_MAIL_ENABLED=true` et la configuration Resend existante. Le mode local
ne contacte jamais le fournisseur, même avec des credentials hérités. Cette
activation ne configure pas le réveil périodique : celui-ci doit être vérifié
séparément dans chaque environnement.

Une intention durable identifie le rappel, sa génération et l’admission de son
destinataire. Un bail et un numéro de clôture protègent les reprises concurrentes.
Juste avant le réseau, le worker revérifie l’état, le début, les droits, l’adresse,
la fenêtre temporelle et l’empreinte du corps. Les reprises utilisent la même clé
d’idempotence et le même corps pendant moins de 23 heures et avant la limite de
début. Une acceptation fournisseur ne prouve pas la réception dans la boîte mail.
Une révocation survenant après la dernière vérification ne rappelle pas un mail
déjà parti. Une issue incertaine reste signalée ; aucun nouvel identifiant n’est
inventé pour la masquer.

Les admissions de rappel sont bornées par les compteurs locaux d’agenda et des
autres envois Hestia. Seuls les compteurs propres à l’agenda sont durables ;
l’historique des autres services peut être purgé. Ces contrôles supplémentaires
ne garantissent donc ni un quota global restant, ni une réserve mensuelle pour
l’identité. La qualification d’activation doit vérifier le quota fournisseur,
sa réserve et l’absence de facturation au dépassement. Un refus temporaire de
budget diffère l’intention, dans sa fenêtre de validité.

La récurrence, les rappels de fin et la synchronisation de calendriers externes
restent en V2. Les résultats réels de qualification et de déploiement sont des
preuves datées ; la présence de ce document n’atteste aucun environnement livré.
