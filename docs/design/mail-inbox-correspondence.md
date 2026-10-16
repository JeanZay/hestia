# À classer : correspondance du hand-off v2

Intégration technique du 15 octobre 2026, issue du hand-off manuel `claude-design-handoff-mail-inbox-v2.zip`. Les décisions et l'autorisation exactes sont conservées par le coordinateur avec le cadrage mail-inbox v5 ; ce document ne crée aucune autorisation de livraison.

Référence : Clé de voûte 1.6 et extensions 1.7 reçues P25 (icônes inbox/history), P26 (SummaryLine), P27 (InboxCount). Aucun nouveau token ni écran de conception agent. Les dépendances de démonstration React/ReactDOM/Babel CDN, Google Fonts, outils de simulation et contenus synthétiques du prototype ne sont pas importés.

## Sources identifiées

| Fichier du hand-off | SHA-256 |
| --- | --- |
| `Hestia A classer.dc.html` | `f70004df1e58c6afb684d82fd4468858e071ed85a6bcb8643ace447cbaf36aba` |
| `ds-ext/propositions-1.7.js` | `7b8be22fa2939bb8f86c34a0face56ac9de0fb09d43fd6e66b53890b0f4b8c68` |
| `Notes - A classer v2.md` | `858ed506d66763fd8a482d352d6b7b4e339efd7f2d02fc12a92a791f27d4bcc3` |
| Cadrage mail-inbox `v4/brief.md` préservé par v5 | `82e93f350067e7ca4d3679af5d0c20afe9cb29456f065da11af59e7b91d407eb` |
| Matrice mail-inbox `v5/scenarios.json`, S01–S37 | `e1f93efc45d9b62c26c0f205c3aeb511d8f932420e45dff6f1f98960efd5909e` |

L'original demeure dans les artifacts ignorés de la racine primaire. Les mentions « proposé / à valider » internes à l'export ne sont pas une source de consentement ; la preuve applicable est celle rapprochée par le coordinateur.

## Correspondance

| Référence v2 | Intégration |
| --- | --- |
| Dossiers, SideNav/BottomNav, P27 InboxCount | `documents-app.tsx`, `inbox-design.tsx` : entrée et compteur dans la navigation existante, accès depuis Dossiers. Les capacités voisines de navigation sont préservées. |
| File regroupée par mail, provenance, accusé, exclusions, écartées | `inbox-workspace.tsx` : liste privée, compteur limité aux attentes, erreurs connues, notices sans pièce importée, masquage explicite sans suppression d'une pièce en attente. |
| Fiche de pièce et aperçu explicite | `inbox-workspace.tsx` réemploie `FilePreview` existant. Aucun contenu n'est chargé avant le geste ; les Blob URL sont révoquées et les réponses tardives après fermeture sont ignorées. Les formats sans aperçu restent classables. |
| P26 SummaryLine | `inbox-design.tsx`, `document-summary.tsx` : états préparation/disponible/indisponible. La lecture ne démarre aucune IA ; les réponses d'une autre révision sont ignorées. Les documents historiques sans résumé n'affichent pas d'état fabriqué. |
| Résumé, suggestions, commentaire privé et DictationControl 1.6 | `inbox-comment.tsx`, `capture-dictation.tsx` : saisie sans troncature, sauvegarde privée avec version, conflit explicite, résultat dicté concurrent présenté séparément, retrait/annulation, relecture. L'admission inbox est discriminée, sans capture fictive ni expiration inventée. |
| Choix manuel, suggestions existantes, chemins et ambiguïtés | `inbox-workspace.tsx` réemploie PickRow et `capture-destinations.tsx` / PathPlan 1.5. Choix manuel conservé quand le commentaire périme les suggestions ; la création attend la confirmation. |
| Doublon identique / homonyme et remplacement | `inbox-workspace.tsx` : résultat borné aux documents consultables, décision explicite ajouter/remplacer, nouvelle prévisualisation après choix, cible et version transmises au serveur, droit manquant expliqué. |
| Vérification, confirmation, accès, erreurs, classement incertain | `inbox-workspace.tsx` : chemin exact et accès renvoyés par le serveur, confirmation liée au jeton, aucune répétition automatique d'une mutation ambiguë, vérification explicite, réessai avec même identifiant après reçu absent. L'opération est conservée pendant la navigation pour le même acteur. |
| Versions et droits distincts v2 | `document-history.tsx` : télécharger demande Consulter+Exporter ; rétablir demande Consulter+Modifier ; motif d'action absente, échéance, confirmation, refus serveur et résultat incertain visibles. La lecture ne qualifie pas le commit : les recontrôles restent serveur. |
| Capture Enregistré | `capture-workspace.tsx` réemploie P26 sur le document réellement confirmé ; ce document reste utilisable pendant l'attente de son résumé. |
| Moi > Envoi par mail | `family-profile.tsx`, `inbox-settings.tsx` : deux interrupteurs distincts, adresse copiable, accusé dépliable, réception/IA explicites. |

## Adaptations techniques bornées

Les textes historiques Resend de la démonstration sont remplacés par le circuit Google validé dans le cadrage v4/v5 : boîte technique Gmail dédiée, maintien jusqu'au résultat durable, puis corbeille Google et conservation habituelle de 30 jours. Le filtrage amont Google n'est pas présenté comme une garantie antivirus Hestia. Aucune connexion à la boîte personnelle n'est annoncée.

Les éléments existants du produit (navigation, recherche, gestion du foyer, corbeille, import et visualisation PDF) sont conservés ; le code CDN et le moteur de simulation du hand-off ne sont pas repris. Les icônes Lucide réemploient les mentions ISC existantes du produit.

Le serveur détient l'autorité sur droits, quotas, échéances, versions, reçus et résumés. Un contrôle client d'échéance sert uniquement à éviter une action périmée à l'écran. Le résumé durable décrit le document seul ; le contexte du mail et le commentaire privé ne sont pas transférés au document par les composants.

## Contrôles et limites

Le 15 octobre 2026 : 18 tests Playwright locaux sur réseau synthétique (9 desktop, 9 téléphone 390 px) ont réussi sur la première série : aucun lancement IA implicite, aperçu à la demande, classement pendant attente, refus d'accès au commit, doublon à choix explicite, vérification d'une issue incertaine et même identifiant au réessai, reprise après navigation, écart/récupération, saisie, clavier, absence de débordement et indépendance des réglages. Quatre tests unitaires du client ont réussi. Le typecheck et l'ESLint ciblé ont réussi ensuite. Les ajouts de tests Versions et les dernières corrections demandent une revalidation finale par le coordinateur.

Ces tests de routefixtures attestent les comportements du client ; ils ne remplacent ni les intégrations serveur réelles, ni l'examen visuel indépendant du candidat complet, ni la réception Google, ni la dictée distante, ni une campagne Browser Use Dev. Aucun résultat de la démonstration n'est transféré au produit et aucun PASS Dev/Production n'est annoncé ici. L'impact sur les fiches Browser Use est proposé séparément, sans admission implicite.

## Corrections après revue indépendante v1

La revue indépendante UI v1 a demandé huit corrections ; les succès antérieurs ne les qualifient pas. Les sources ci-dessus demeurent l'autorité de comportement, avec le besoin public [Issue 9](https://github.com/JeanZay/hestia/issues/9). Le rapport détaillé, ses empreintes et le candidat antérieur sont conservés dans les artifacts de qualification.

- UI-01 : la reprise d'une opération conserve son identité opaque et propose la vérification du reçu avant toute lecture de contenu. Une pièce déjà classée n'a plus à rester accessible par GET pour permettre cette vérification. Une lecture de pièce après reçu absent prépare seulement le réessai explicite avec la même clé.
- UI-02 : une ancienne version est téléchargée par portions d'au plus 2 Mio via les paramètres `offset`/`length` réels ; taille, Content-Range et SHA-256 complet sont vérifiés avant de proposer le fichier à l'appareil.
- UI-03 : les lectures initiales et de polling portent une génération du commentaire. Une réponse engagée avant une saisie locale ne réactive aucune suggestion périmée ; le dossier manuel reste choisi.
- UI-04 : le Dialog de remplacement reprend la décision et le texte v2 : les lecteurs verront le nouveau contenu, tandis que nom, emplacement et accès restent ceux de la cible ; l'ancienne version et son résumé restent récupérables sept jours.
- UI-05 : la projection courante fournie par le serveur est rendue avec la composition déjà intégrée dans Capture : message, capacités personnelles et personnes/capacités seulement lorsque le serveur les divulgue.
- UI-06 : le geste Photo mobile ferme la vue inbox, comme la navigation desktop.
- UI-07 : attente, en cours, suggestions prêtes, aucune suggestion, indisponible, résultat inconnu et suggestions périmées sont distingués ; le résumé prêt et le résultat vide explicite suivent la v2, sans inventer une cause.
- UI-08 : les anciennes versions expirées deviennent des métadonnées opaques datées ; leurs noms, taille/hash et résumé ne sont plus rendus et aucune action de téléchargement/rétablissement n'est proposée.

Deux nouveaux tests Playwright sont préparés contre les vrais handlers HTTP, SQL et stockage du banc synthétique possédé : commit avec réponse perdue puis navigation/reçu alors que le GET de pièce classée retourne 404 ; téléchargement UI d'une ancienne version de plus de 2 Mio avec contrôle du hash, puis relecture de sa métadonnée expirée. Leur préparation SQL/S3 est explicitement séparée des gestes UI. Ils sont ignorés hors du banc dont le marqueur de propriété est vérifié. Des contre-exemples de saisie pendant lecture, confirmation de remplacement, projection d'accès et Photo mobile complètent les routefixtures. Six tests unitaires du client ont réussi après ajout de la lecture par portions et des contrôles d'intégrité ; les nouvelles preuves navigateur et la contre-revue du candidat corrigé restent à exécuter.

Les propositions Browser Use révisées conservent leurs limites : aucun scénario technique S16, S19 ou S21 n'est déclaré entièrement couvert par les seules observations UI. Une mutation incertaine arrête la campagne ; la réconciliation et une éventuelle reprise nécessitent une nouvelle sélection autorisée et une nouvelle campagne. Aucune fiche n'est admise par la préparation ou par les tests Playwright.

## Propagation de divergence privée — correction technique du 16 octobre 2026

Les raisons déjà affichées par PickRow et PathPlan portent maintenant la raison documentaire et, lorsqu'elle est émise et validée, la divergence avec le contexte privé. La composition est exactement `raison + " " + contradiction` : jusqu'à 500 points Unicode pour la raison, un espace et 1000 pour la contradiction, soit 1501 points. Le parseur provider conserve ses bornes initiales ; aucune troncature, nouveau bandeau, nouvel emplacement ou changement de prompt n'est introduit. Les suggestions demeurent soumises au choix humain et aux droits recontrôlés côté serveur. Une divergence applicable sans suggestion admise aboutit à l'état indisponible existant.

Le sujet, le corps du mail ou le commentaire non blanc constituent un contexte ; une enveloppe JSON vide et le seul indicateur de corps partiel n'en constituent pas un. La contradiction reste dans l'analyse privée et dans les raisons existantes ; le résumé durable reçoit seulement les octets et le type du document. `src/server/inbox/analysis.ts` centralise la projection ainsi que sa validation structurale réutilisable pour les preuves. Cette validation ne prouve pas à elle seule ce qu'un provider réel a émis.

Une modification du commentaire, une analyse en attente/périmée/indisponible/inconnue, un rangement ou la purge effective ne réexposent pas l'ancienne divergence. Une pièce écartée demeure récupérable sept jours avec la même analyse ; la remise ne déclenche pas de nouvelle analyse. Le départ conserve la protection existante par époque d'admission. Cette réparation concerne les assertions des parcours de suggestions et de récupération existants ; elle n'admet aucune nouvelle fiche Browser Use et ne transfère aucun résultat local vers Dev.
