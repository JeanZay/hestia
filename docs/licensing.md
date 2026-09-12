# Choix de licence à valider

État au 12 septembre 2026 : Hestia est un projet local destiné à devenir open source. Aucune licence du projet n'est encore accordée et aucun dépôt distant n'est publié. Ce document expose une recommandation ; il n'applique aucune des licences comparées. Les dépendances conservent leurs licences propres.

## Proposition

**Recommander Apache-2.0** pour le code et la documentation originale du projet, sous réserve de décision explicite du responsable du projet et de vérification des droits sur les contributions. Ce choix favorise la réutilisation large, y compris commerciale, tout en formulant une concession de droits sur certains brevets des contributeurs. Il demande notamment de conserver les mentions requises, fournir la licence et signaler les fichiers modifiés lors des redistributions concernées. [Texte officiel Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0.html).

Le compromis à accepter est l'absence d'obligation générale de republier les améliorations : une entreprise peut proposer un service ou une variante propriétaire en respectant la licence. Si le maintien des modifications dans le patrimoine commun est une priorité supérieure à la réutilisation permissive, AGPL-3.0 mérite d'être préférée.

## Comparaison pour la décision

| Option | Effet pratique | Point d'attention |
| --- | --- | --- |
| Apache-2.0, recommandée | Réutilisation, modification et redistribution larges ; concession explicite de certains droits de brevet des contributeurs. | Préserver les mentions applicables et indiquer les modifications ; les dérivés ne sont pas obligatoirement ouverts. [Source Apache](https://www.apache.org/licenses/LICENSE-2.0.html). |
| MIT | Licence permissive très courte ; réutilisation et redistribution larges avec conservation de la notice. | Son texte ne comporte pas une clause de brevet distincte comme Apache-2.0 ; aucune obligation générale de publier les améliorations. [Source OSI](https://opensource.org/license/mit). |
| AGPL-3.0 | Copyleft ; la section 13 impose à une version modifiée d'offrir le code source correspondant aux utilisateurs qui interagissent avec elle à distance par réseau. | Exigences plus étendues à analyser pour les modifications et combinaisons ; choisir explicitement « seulement cette version » ou « cette version ou ultérieure ». [Texte approuvé par l'OSI](https://opensource.org/license/agpl-3-0). |

La licence du code ne publie pas les documents des foyers et n'autorise pas leur collecte. Elle ne remplace ni la politique de confidentialité de l'instance ni l'autorisation de communiquer une donnée à un tiers. Les trois options permettent des usages commerciaux ; vouloir exclure ces usages conduirait à une autre catégorie de licence et serait contraire à l'objectif d'ouverture retenu.

## Réversibilité et limite

Tant que le projet n'a pas été distribué sous une licence, la proposition peut être changée avant publication. Après distribution, une décision ultérieure ne doit pas être présentée comme une reprise des droits déjà accordés aux destinataires. Apache-2.0 formule expressément les concessions prévues aux sections 2 et 3 comme irrévocables sous les conditions du texte. [Texte officiel Apache](https://www.apache.org/licenses/LICENSE-2.0.html).

Les contributions ultérieures devront avoir une provenance et des droits compatibles ; changer la licence de leur ensemble peut exiger l'accord de leurs titulaires. Aucun titulaire de droits n'est inventé par la fondation et aucun texte LICENSE n'est ajouté avant le choix explicite.

## Après décision, avant publication

Le lot de publication devra appliquer le texte exact et l'identifiant SPDX décidés, déterminer les mentions de titulaire de droits, vérifier les dépendances et ressources tierces et mettre à jour les métadonnées du projet. Pour Apache-2.0, un fichier NOTICE est ajouté si des mentions applicables l'exigent, sans inventer d'attributions. La fondation Apache explique la procédure d'application et les notices. [Guide officiel d'application Apache](https://www.apache.org/legal/apply-license.html).

La décision sur la licence et l'autorisation de publier sur GitHub sont distinctes. Un accord sur Apache-2.0 n'autorise ni création d'un dépôt public ni push ; la publication fera l'objet du GO explicite prévu par la gouvernance. Ces étapes seront suivies dans GitHub après autorisation, sans backlog Markdown parallèle.
