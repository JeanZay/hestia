# Intégration du hand-off Agenda V1

Référence produit : [besoin #79](https://github.com/JeanZay/hestia/issues/79) et son [brief immuable](https://github.com/JeanZay/hestia/issues/79#issuecomment-6256429340).

Le port React reprend la composition du hand-off Agenda V1 et le complément de relecture de conflit. Les sources de conception restent dans les preuves locales ignorées ; aucun moteur simulé, compte de démonstration, outil de simulation, package Claude ou ancien bundle de Design System n'est importé dans le produit.

## Références exactes

- Export initial : `claude-design-handoff-ideas-agenda-v1.zip`, SHA-256 `b006ea843d75de41121445fdc801fccc026b70ab2ef4e6094b1e70e8bd89e298` ; sources contrôlées dans `artifacts/design-handoffs/ideas-agenda-v1-20261019/source/`.
- Complément : `Hestia Agenda.dc.html`, SHA-256 `37a5af7114168d2de451358bdba0b4e241c1ef2412653fd06b7db6f433261b6b` ; modèle `15dd25d6623773338597d832139b15c6d7f216f7faca7632ac66b022a2de78d8` ; notes `bfc91735ec70a8a735cde73db17ac408454c00247259dfdf5ac41d81f6b6db42`.
- Réception et revue documentaire : `artifacts/design-handoffs/ideas-agenda-conflict-v2-20261019/reception-manifest-v1.json` et `artifacts/refinement/ideas-agenda-20261015/preparation-review-20261019/design-complement-review-v1.json`.
- Design System actuel conservé ; extension 1.10 pour les rangées Agenda, navigation par jour et rappels. Les valeurs CSS portées proviennent de ces sources ; aucune nouvelle extension n'est définie.

## Correspondance

| Conception | Intégration |
| --- | --- |
| Agenda, onglets Jour / Liste / Archives | `AgendaWorkspace`, listes réellement chargées par `/api/hestia/agenda` ; filtres et pagination serveur |
| `CDVP10.DayNav` | En-tête de jour, précédent/suivant, Aujourd'hui et champ Aller au |
| `CDVP10.AgendaRow` | Rangées avec repère temporel de 88 px, titre, métadonnées autorisées et chevron ; groupes sans heure/en cours puis horaires |
| Fiche, données, liens et documents | Vue de détail avec projection serveur ; aucune métadonnée sur une association indisponible |
| `CDVP10.ReminderLine` | Configuration et état réel renvoyés par le service ; acceptation distincte de réception |
| Édition | Titre, description, catégorie, dates facultatives, partage, liens, associations documentaires et rappels multiples |
| Sélecteur de documents | Documents consultables paginés ; droits de dossier indépendants du partage de fiche |
| Déposer et associer | Protocole existant de dépôt par chunks et finalisation, même opération sur reprise ; association ajoutée seulement après finalisation |
| Dépôt sans Consulter | Jeton d'upload finalisé soumis au contrôle serveur, association opaque affichée « Document indisponible », aucun identifiant documentaire inventé |
| Relecture d'un conflit | Comparaison complète champ par champ, valeurs identiques ou différentes, deux colonnes empilables sur téléphone ; saisie locale conservée |
| Choix de version | Garder ma saisie reste sans écriture ; Reprendre demande confirmation puis relecture actuelle avant remplacement ; aucune fusion |
| D_TECH_1 | Recontrôle des droits et de la révision au clic final de confirmation de Reprendre ; une troisième modification impose une nouvelle relecture |
| D_TECH_2 | Comparaison des valeurs complètes et affichage Premier / Second passage dans Quand |
| Réponse perdue | Vérifier le résultat ; si aucun reçu n'est visible, réessayer le même identifiant et le même corps, sans seconde intention |
| Navigation mobile | Dossiers, Agenda, Échanges, Photo, Moi ; recherche en haut, Corbeille/Foyer accessibles depuis Moi ; recherche desktop conservée |
| Annuler / quitter une saisie | Dialogue existant d'abandon ; résultat incertain et transfert en cours demandent réconciliation avant changement de rubrique |

## Adaptations techniques

Le modèle visuel est remplacé par le contrat partagé et les services authentifiés. Le calcul affiché des heures réutilise les fonctions pures de temps du serveur ; il ne déclenche aucun rappel. Un changement d'heure inexistant ou ambigu appelle la clarification déjà définie ; la fin peut avoir une heure sans imposer d'heure de début.

Chaque transport Agenda appartient à la session affichée. Il vérifie l'acteur encodé dans `X-Hestia-Actor`, refuse un succès sans acteur, ignore une réponse arrivée après annulation et vide l'interface si le compte change. Les lectures au retour de focus et périodiques recontrôlent l'accès ; l'API reste la barrière d'autorisation à chaque geste. Chaque changement de destination invalide les réponses de la vue précédente. Les lectures de fiche, documents et membres possèdent également leur ordre de requête : une réponse ancienne ne peut remplacer une projection plus récente, même si la révision métier est inchangée après une révocation documentaire. Les écritures et les transferts vérifient la destination après chaque attente. Les lectures de fichiers sont annulées au démontage de leur composant. Une panne initiale de lecture des membres expose le bouton Réessayer et conserve la saisie.

Les documents sont relus avant ouverture/téléchargement ; chaque portion est protégée par le protocole documentaire existant et l'intégrité est vérifiée. Une association retirée ne supprime pas le document du coffre. Un résultat de transfert incertain conserve son opération jusqu'à reprise ou annulation certaine.

Photo conserve la capacité existante : sa destination reste visible dans les cinq entrées mais son bouton est indisponible lorsque l'appareil ne permet pas ce parcours. Aucun parcours de capture alternatif n'est conçu ici.

## Vérification

Les tests client ciblent session, conflit, dernière révision, conservation des liens opaques, intention stable après perte de réponse et temps Paris. Les tests navigateur `tests/e2e/agenda.spec.ts` distinguent les scénarios de contrat HTTP isolés et le scénario nommé « API RÉELLE du banc possédé », sans interception métier : connexion d'un compte synthétique, création, consultation liste/jour, archivage et réouverture. Ils sont joués sur desktop et téléphone. Les régressions asynchrones retiennent une ancienne lecture A pendant l’édition de B ou la création d’une nouvelle fiche, puis vérifient l’URL et la révision de la mutation. Deux lectures inversées de la même fiche vérifient qu’une projection documentaire révoquée reste masquée ; une panne des membres vérifie une reprise sans perte de saisie. Les tests PostgreSQL et preuves du moteur restent distincts ; aucun test navigateur local n'atteste de réception mail ou de cadence distante.

La présence de cette correspondance n'est pas un PASS de revue visuelle, de recette Dev ou de Production. Les résultats réellement exécutés et l'identité du candidat sont conservés dans les preuves du lot.
