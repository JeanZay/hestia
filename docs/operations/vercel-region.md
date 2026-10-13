# Région des fonctions Vercel

Hestia fixe `regions: ["fra1"]` dans `vercel.json` pour rapprocher les fonctions de la base et du stockage référencés à Francfort. Ce réglage concerne les prochains déploiements ; il ne déplace pas un déploiement existant. Il ne prouve ni la localisation actuelle des données, ni un gain de latence.

La [documentation Vercel](https://vercel.com/docs/functions/configuring-functions/region), consultée le 13 octobre 2026, distingue les réglages du projet, du fichier, des fonctions individuelles et de la CLI. Le contrôleur local refuse une région différente, une nouvelle région de secours et le mode `--prebuilt`, dont les fonctions ne sont pas inspectées ici. Les fonctions Hestia n'ont actuellement aucun `preferredRegion` spécifique dans leur source.

## Projection de la configuration

Les opérateurs locaux préparent un fichier `vercel.operator.json` pour conserver leurs contrôles de construction. Recréer ce fichier avec seulement `buildCommand` et `crons` perdrait la région. Utiliser le module **du candidat exact** :

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { projectVercelConfig, assertVercelDeployment } from './scripts/lib/vercel-region.mjs';

const read = file => JSON.parse(readFileSync(file, 'utf8'));
// Ces valeurs et chemins viennent du contrat opérateur qualifié.
const overrides = { buildCommand: BUILD };
const config = projectVercelConfig(read(sourceConfigPath), overrides);
writeFileSync(operatorConfigPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
```

`BUILD` reste la commande exacte déjà qualifiée par l'opérateur, avec ses guards. Le cron versionné est conservé par défaut. Si un contrat opérateur autorise explicitement une liste de crons différente, la passer comme `overrides.crons` et conserver ce choix dans les preuves ; ne pas désactiver le cron implicitement.

Juste avant le lancement autorisé, après les contrôles habituels d'accord, d'identité du candidat, d'archive, de configuration et de continuité :

```js
const args = ['deploy', sourceDirectory, '--local-config', operatorConfigPath,
  ...qualifiedDeploymentArguments];
assertVercelDeployment({
  sourceConfig: read(sourceConfigPath),
  deploymentConfig: read(operatorConfigPath),
  overrides,
  configPath: operatorConfigPath,
  args,
});
// Poursuivre uniquement avec ces mêmes args dans le qualifiedRun existant.
```

`qualifiedDeploymentArguments` ne doit ajouter aucun autre `--local-config` ni `-A`. L'opérateur conserve et recontrôle l'empreinte du fichier réellement désigné, des choix explicites et de la source ; aucune réécriture ne doit intervenir entre admission et lancement. La comparaison couvre toute la projection et la commande de construction, pas seulement `regions`. Le module ne lance aucune commande, n'accorde aucune permission et ne remplace aucun contrôle existant.

Les anciens opérateurs et reçus sous `artifacts/` restent des preuves figées. Pour un nouveau déploiement, préparer et faire relire un nouvel opérateur consommant ce module, avec une preuve du chemin réellement invoqué. L'ajout du module ne modifie pas rétroactivement ces scripts. Un test unitaire de projection seul ne qualifie pas l'opérateur distant.

## Vérification avant et après livraison

1. Avant la livraison, relever en lecture seule les identifiants du projet, du déploiement derrière l'alias stable, son SHA, ses régions effectives et les réglages actuels. Préserver séparément Dev et Production. La région des machines de build ou celle d'un point CDN n'est pas la région d'exécution des fonctions.
2. Vérifier la région actuelle du projet/endpoint Neon et du stockage à partir de leurs métadonnées autorisées. Consigner uniquement région, environnement, date et références non sensibles. Une ancienne preuve ou un nom d'hôte ne remplace pas cette observation ; si elle est inaccessible, signaler la vérification manquante avant une livraison régionale en Production.
3. Après création autorisée du déploiement, vérifier son identité, son état `READY`, la commande de construction et les régions effectives des fonctions. Elles doivent correspondre à `fra1` ; un défaut de métadonnées ou une contradiction bloque la promotion de l'alias et demande réconciliation. Garder les contrôles de cron, de profil d'exécution, de source et de configuration du protocole existant.
4. Après promotion autorisée, relire la cible de l'alias puis effectuer les contrôles techniques prévus. Comparer les temps API avec des données synthétiques et distinguer exécution, réseau, base et stockage. Dev déjà situé à Francfort ne constitue pas un avant/après de la correction régionale de Production.

## Retour arrière et limites

Avant un GO Production, identifier le déploiement précédent, sa configuration, sa commande de construction et l'alias exact à restaurer ; vérifier qu'il reste disponible. Le contrat de livraison doit couvrir explicitement la restauration de cet alias en cas d'échec des contrôles. Conserver intention, résultat et vérification de la cible ; une issue incertaine impose la réconciliation avant toute répétition.

Ce lot ne modifie ni offres, fournisseurs, base, stockage, capacité, verrouillage applicatif, schéma, secrets ou interface. Les gains chronométriques et les parcours sur téléphone restent à mesurer. Le [circuit Hestia](../delivery-governance.md) distingue qualification locale, publication GitHub, Dev et GO Production sur le candidat exact.
