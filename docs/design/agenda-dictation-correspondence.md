# Formulaire Agenda et dictée — V1

Référence : [Issue86](https://github.com/JeanZay/hestia/issues/86), brief figé SHA-256 `3d6faaea40eeea175bf43ea417302fc773c96095325847eb84d59bf186c18261`. Le GO du 24 octobre couvre l’intégration du rendu présenté dans Claude Design, puis Dev et Production après qualification. La photo directe à la création reste différée.

## Sources de conception

Le projet Claude Design Hestia contient la copie « Hestia Agenda - fiche dictee », réalisée le 23 octobre puis corrigée pour conserver la confirmation de toute saisie modifiée. La récupération textuelle, ses reçus et ses limites restent dans `artifacts/design-prompts/card-form-20261023/`, hors publication.

- HTML LF récupéré : SHA-256 `9e3b37a9b06a315f24b4c37cc55a528f431d77aa78080aef18218221ba908dd0`.
- Notes LF récupérées : SHA-256 `a150a3e2d33f6c0ba4ae37613076d15fa66a5c9b1a37752e963d7ed5c2612118`.
- Design System Clé de voûte 1.6 : P21 DictationControl et P22 LengthMeter ; Agenda extension1.10. Aucun nouveau composant graphique, jeton, police ou dépendance.

Le texte exposé par Claude a été préservé avec normalisation CRLF vers LF ; il ne constitue pas une archive originale authentifiée. Aucune source de démonstration, moteur simulé ou outil Claude n’est exécuté ou embarqué dans le produit. Les styles techniques reprennent les composants déjà intégrés et les compositions explicites du hand-off.

## Correspondance

| Hand-off | Intégration |
| --- | --- |
| Dates, groupe Fin avec aide commune et champ Date de fin | `agenda-workspace.tsx`, grille `minmax(min(100%,220px),1fr)` dans `agenda.css` ; aide reliée au champ, erreurs conservées sous chaque saisie |
| Actions collées au bas de la zone défilante, largeurs égales | `.ha-save`, `.ha-save-buttons`, marges compensant le contenu, safe area, scroll padding ; Annuler secondaire |
| Clavier mobile | viewport `resizes-content` et `viewport-fit=cover`, hauteur `dvh`, secours `visualViewport` limité au formulaire ; barre basse conservée dans le DOM et placée sous la zone visible pendant le clavier |
| P21/P22 sous Titre et Description | `agenda-dictation.tsx` réemploie les styles P21/P22 existants, minuteur deux minutes, arrêt/annulation, compteur et résultat séparé |
| Ajout, relecture, retrait prudent | `agenda-dictation-client.ts` et `shared/agenda-dictation.ts` ; ajout à la fin sans normaliser le texte existant, paragraphes, compte serveur en points de code, sans troncature |
| Saisie modifiée pendant la dictée | Versions locales distinctes du texte : même une modification puis restauration exige un choix explicite ; ajout, correction ou rejet du résultat proposé |
| Refus d’enregistrer pendant la dictée ou un arbitrage | Résumé prenant le focus et raison associée à Enregistrer ; disparition du résumé dès la résolution ; une seule dictée active |
| Confirmation d’abandon | Comparaison à l’état d’ouverture et présence de voix/résultat/fichier ; Continuer la saisie conserve tout, Abandonner annule avant navigation ; formulaire inchangé quitté directement |
| Isolation et interruptions | UUID de session de formulaire, compte attendu, fiche/révision et champ ; refus des réponses tardives, arrière-plan, remplacement, conflit, perte des droits ; aucune sauvegarde implicite |

La navigation, le partage, les liens, documents, rappels et conflits existants restent la référence du produit. Le compteur incident « Échanges (5) » du prototype n’est pas importé. Les champs de texte utilisent les limites et caractères du serveur Agenda ; le comptage JavaScript approximatif de la démonstration n’est pas repris.

## Frontière technique et qualification

La source Agenda de `/transcriptions` ne crée ni fiche ni Capture et n’expose aucun texte existant au fournisseur. Elle réutilise le plafond, les reçus d’idempotence et l’audio éphémère existants, sans migration. Pour une fiche existante, le serveur contrôle le créateur autorisé, la révision exacte et l’absence d’archivage avant et après l’appel ; un administrateur n’obtient aucun droit supplémentaire.

Les tests emploient uniquement des membres, documents, microphones et fournisseurs synthétiques. Les résultats effectifs et l’identité du candidat appartiennent au dossier de qualification, pas à ce document de correspondance. Les essais avec clavier physique iOS/Android et qualité de reconnaissance réelle restent distincts ; aucune simulation ne les certifie.
