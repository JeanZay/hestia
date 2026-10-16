import type { Actor } from '../access';
import { CAPABILITIES } from '../permissions/capabilities';
import { evaluateTreeAccess, type AccessGraph } from '../permissions/tree';
import type { CaptureAccessProjection } from '../../shared/capture-contract';

/** Same disclosure envelope as Capture: rights alone never disclose another member. */
export function projectInboxAccess(graph: AccessGraph, actor: Actor, baseId: string | null): CaptureAccessProjection {
 if (!baseId) return {
  capabilities: [...CAPABILITIES],
  message: 'Privé — vous seul. À la racine, dans votre espace. Personne d’autre que vous n’y aura accès tant que vous ne l’aurez pas accordé.',
  people: [{ id: actor.id, name: actor.name, capabilities: [...CAPABILITIES] }],
 };
 const rights = evaluateTreeAccess(graph, actor.id, baseId);
 const projection: CaptureAccessProjection = { capabilities: [...rights.capabilities], message: 'Les accès actuels du dossier choisi s’appliqueront à ce document, y compris aux nouveaux sous-dossiers.' };
 if (rights.canShare || rights.canAdminister) {
  projection.people = graph.members.filter(member => member.active).map(member => {
   const capabilities = evaluateTreeAccess(graph, member.user_id, baseId).capabilities.filter(capability => member.user_id === actor.id || Boolean(rights.authorityFor([capability], member.user_id)));
   return { id: member.user_id, name: member.name, capabilities };
  }).filter(person => person.capabilities.includes('consulter'));
 }
 return projection;
}
export function inboxAccessLabel(projection: CaptureAccessProjection, privateRoot: boolean) {
 return `${privateRoot ? 'Privé — vous seul. ' : ''}Vos droits à cet emplacement : ${projection.capabilities.join(', ')}.`;
}
