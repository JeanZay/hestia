# Qualification commentaire et dictée

Ce banc est local, synthétique et distinct des recettes Browser Use. Utiliser exclusivement le runner possédé `scripts/e2e.mjs`, après un build du candidat figé. Il crée puis détruit ses propres PostgreSQL/S3 ; aucune URL DB ambiante ni clé de fournisseur n’est employée.

```text
node scripts/e2e.mjs --config tests/qualification/comment-voice/playwright.config.ts
node scripts/e2e.mjs --config tests/qualification/comment-voice/performance.config.ts
```

Le premier sélectionne treize parcours mobiles : saisie/Unicode, autosave retardé, conflit entre éditeurs, conservation du dossier manuel et nouvelle confirmation, reprise caméra, refus microphone, ajout vocal/concurrence, dépassement/panne, annulation/réponse tardive, contradiction, autosave pendant un upload de page, capture microphone native simulée et désactivation d’un modèle indisponible. Les mêmes E2E font partie des projets desktop/mobile habituels ; les deux cas caméra y sont réservés au mobile.

Les appels de commentaire, préparation, confirmation et upload utilisent le serveur et la base réels du banc. Les réponses de classement et STT indiquées dans les tests sont des stubs de transport Playwright pour éprouver des états UI déterministes. Elles ne qualifient ni le service réel, ni ses droits ou son budget : les tests d’intégration serveur injectent séparément des fournisseurs synthétiques via `createApplication`.

Le microphone synthétique remplace uniquement `getUserMedia` par un flux audio généré en mémoire. Le vrai module d’enregistrement de l’application utilise son AudioWorklet, ses tampons bornés, son encodage WAV et sa libération de pistes. Aucune voix privée ni audio préenregistré réel n’est utilisé. Ce banc ne prouve pas le fonctionnement d’un microphone physique ou de son dialogue natif de permission.

La qualification performance est explicite et exclue des mesures E2E régulières. Elle conserve 5 échauffements et 30 mesures de saisie jusqu’à deux frames, puis observe deux secondes de minuteur avec conservation du focus, du curseur et du scroll. Le nombre d’autosaves, analyses, préparations et lectures de contenu est contrôlé. Aucun seuil de latence nouveau n’est inventé ; les chiffres restent séparés de la baseline des parcours préexistants. Les comptes de commits React ne sont pas mesurés dans ce build de production.

La preuve navigateur d’absence de préparation supplémentaire est un constat de requêtes, de versions de pages et d’octets finaux identiques. Les compteurs internes du moteur de rendu sont vérifiés dans les tests d’intégration ; le navigateur seul ne les certifie pas.

Avant/après : rejouer aussi les configurations existantes `mobile-workspace` et `mobile-photos` avec les mêmes corpus, ordre, environnement et identité de build que la baseline. Aucun PASS ancien n’est transférable. Les snapshots et rapports locaux sont conservés sous `artifacts/qualification/comment-voice/` et `artifacts/performance/`.

Les six nouvelles propositions de recette Browser Use restent dans le dossier ignoré de préparation tant que leur admission et la campagne exacte ne sont pas effectuées. Aucun script présent ne démarre cette campagne.

Le test « Dictée native simulée » ouvre son propre Chromium avec fake-device et fake-ui. Il laisse getUserMedia natif, vérifie le header microphone=(self), le vrai AudioWorklet/WAV et les pistes terminées. Seule la réponse HTTP STT reste synthétique ; cela ne qualifie pas un microphone physique ou le fournisseur.

Le benchmark WAV exécute l’implémentation exportée exacte de l’encodeur dans le thread principal Chromium, sur 120 secondes de PCM synthétique préalloué : 5 échauffements, 30 mesures, taille/en-tête vérifiés et long tasks observées. Acquisition, rééchantillonnage et réseau sont exclus ; aucun temps Node n’est extrapolé.
