# Correspondance Envois V2

Référence locale du 18 octobre 2026 : `claude-design-handoff-outgoing-email-v2.zip`, SHA-256 `98b5ee741f32a5044249ec78c3c1893dee5a3b18dc9d1b7b397208fa01f1d76a`, 166 entrées. Ce hand-off reconstruit localement a reçu le GO design V2. L'archive native distante et sa fin de fichier ne sont pas authentifiées par cette empreinte locale.

Sources retenues :

| Source | SHA-256 |
| --- | --- |
| `Hestia Envois.dc.html` | `9fa179ed8125d692dd718a5f3cfce6bfaf2f9c6a07c03cc40ceebe1068a0b809` |
| `ds-ext/propositions-1.9.js` | `788c0c58c61500e876bdbe871a0de658681f3de8a256e3141130041de5c55c69` |
| `Notes - Envois email v2.md` | `3d76f0e3edd677f9ee4a3529e34bc241bd6bedc4279f3530fd7754612c2e1ba8` |

Le Design System reste Clé de voûte 1.6, base1.0 et extensions réemployées ; P30–P33 de1.9 sont repris pour ce lot. Les mentions « proposé » des originaux restent intactes. Les notes V2 remplacent les passages V1 sur navigation, conflit et noms de pièces.

## Sources et ports

| Élément du hand-off | Port / raccord |
| --- | --- |
| P30 `send` | Tracé statique dans `design-system.tsx`, Lucide ISC. |
| P31 RecipientList | `outgoing-design.tsx` et `outgoing.css` : saisie libre, séparateurs/blur/Entrée, étiquettes, retrait44px, erreurs en mots+icône+trait. `useId` remplace le compteur global. |
| P32 SizeMeter | Mêmes tokens, barre8px, format français et dépassement en mots. La limite est comparée en octets, pas à l'affichage arrondi. |
| P33 AttachmentRow | Titre et filename distincts, états normal/titre modifié/fichier remplacé/indisponible ; reconfirmation et actions fournies. |
| HTML Envois113–241, reprise V2 | `outgoing-workspace.tsx` : préparation, sélecteur intégré, conflit, erreurs, récapitulatif, transmission, acceptation/refus/incertitude, abandon. |
| HTML Échanges52–59 et navigation V2 | `documents-app.tsx` et `ExchangesWorkspace` : desktop Envois après À classer ; mobile remplace seulement À classer par Échanges, même ordre et conditions Photo/Foyer/Corbeille. |
| Fiche74–91 | `file-workspace.tsx` : Ajouter à l'envoi après Télécharger, absence sans Exporter, doublon/verrou expliqués. Callback direct de recherche et transit par `FolderWorkspace` pour les dossiers. |
| Moi / réception | Nouveau libellé Recevoir des pièces par mail dans le profil et titre cohérent des réglages, sans modifier les réglages de réception. |

Les états existants du produit, les résumés, l'historique de versions, l'aperçu lié au SHA, la capture, les brouillons et les accès sont conservés. La démonstration historique `DemoApp` n'est pas branchée à la route produit et n'est pas modifiée.

## Adaptations techniques

La simulation est remplacée par `outgoing-client.ts` et les DTO partagés du serveur. Aucun faux compte, fichier de démonstration, token graphique, runtime DC, React/Babel sur CDN ou Google Fonts n'est embarqué. IconButton/FileThumb/Progress reprennent les géométries DS du package. Le bouton Vérifier conserve son chevron droit ; le DS produit gagne seulement une prop optionnelle `iconRight`, sans effet sur les utilisateurs existants. Les styles Envois restent sous préfixe `ho-` ; seule sa composition peut dépasser le conteneur commun pour retrouver le centrage760px fourni.

L'état volatile appartient à l'acteur courant. `clearPrivate` annule les requêtes et efface la composition locale ; aucune persistance navigateur ni journal de composition n'est ajoutée. Les lectures obsolètes et réponses d'opérations ne rétablissent pas un ancien écran après changement de session ou nouvelle saisie. Les sauvegardes sont sérialisées, conditionnelles à la révision serveur ; le choix « ma version » utilise la révision présentée et une troisième écriture conserve le conflit. Le choix « version enregistrée » relit le serveur.

Les mutations ne sont jamais répétées automatiquement. Un clic d'envoi possède un `requestId` stable ; perte de réponse laisse le résultat incertain et interdit un nouveau clic. La réconciliation effectue des lectures d'état/opération. Les contrôles serveur, sans objet de stockage exposé au client, restent la frontière d'autorisation.

Deux réserves du prototype sont traitées explicitement : la taille d'une pièce et le total restent ceux du contenu immuable choisi tant qu'une nouvelle version n'est pas acceptée ; deux documents ayant le même filename restent deux identifiants distincts, sans fusion ni renommage. Le contenu `unavailable` n'expose plus de métadonnée documentaire ; une projection nouvelle invalide le récapitulatif qui les affichait auparavant.

Les titres/fichiers longs passent à la ligne, les retours focus et annonces suivent les états fournis. Le sélecteur conserve les cases par dossier et n'autorise ni import appareil ni pièces À classer. Le récapitulatif expose les filenames réellement choisis, les destinataires visibles entre eux, la sortie des copies de Hestia et la conservation Resend30jours ; l'acceptation n'est pas présentée comme une preuve de remise.

## Preuves et limites

Huit tests unitaires ciblent l'annulation d'acteur, les conflits successifs, le non-rejeu d'envoi ambigu/double clic, l'invalidation du récapitulatif après retrait d'accès, les homonymes, la taille choisie et le seuil20Mio+1, la conservation d'une nouvelle saisie après refus et les réponses d'opération tardives. Les sorties des contrôles UI sont conservées sous `artifacts/qualification/outgoing-email-20261018/ui/` par l'auteur.

Cette correspondance ne constitue pas la revue indépendante du code, une preuve navigateur, une campagne Browser Use ou un GO de déploiement. Le coordinateur conserve la qualification intégrée du candidat et la livraison Dev/Production. Le point de lisibilité des sept entrées mobiles est celui du hand-off validé ; aucune réorganisation supplémentaire n'est conçue par l'agent.
