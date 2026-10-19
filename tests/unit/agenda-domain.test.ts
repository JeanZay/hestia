import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {agendaLocalCandidates,agendaLocalParts,agendaReminderDue,agendaCutoff,computeAgendaTiming,resolveParisLocal} from '../../src/server/agenda/time';
import {AgendaValidationError,validateAgendaInput,validateAgendaList} from '../../src/server/agenda/validation';
const input=(extra:Record<string,unknown>={})=>({requestId:randomUUID(),revision:0,title:'Fiche synthétique',description:'',category:'',startDate:null,startTime:null,endDate:null,endTime:null,startFold:null,shareMode:'all',readerIds:[],links:[],documentIds:[],retainedDocumentLinkIds:[],reminders:[],...extra});
const now=new Date('2027-01-01T10:00:00Z');
describe('Agenda V1 temporal and request boundaries',()=>{
 it('distinguishes civil days from elapsed hours at both DST transitions',()=>{
  for(const [date,expected] of [['2027-03-29','09:00'],['2027-11-01','11:00']]){const f=validateAgendaInput(input({startDate:date,startTime:'10:00'}),true,now);const days=agendaReminderDue(f,{id:randomUUID(),unit:'days',value:2,sendTime:null}),hours=agendaReminderDue(f,{id:randomUUID(),unit:'hours',value:48,sendTime:null});expect(agendaLocalParts(days).time).toBe('10:00');expect(agendaLocalParts(hours).time).toBe(expected);}
 });
 it('requires explicit start fold but refuses ambiguous end and reminder times',()=>{
  expect(agendaLocalCandidates('2027-03-28','02:30')).toHaveLength(0);expect(agendaLocalCandidates('2027-10-31','02:30')).toHaveLength(2);
  expect(()=>validateAgendaInput(input({startDate:'2027-10-31',startTime:'02:30'}),true,now)).toThrow(AgendaValidationError);
  const first=validateAgendaInput(input({startDate:'2027-10-31',startTime:'02:30',startFold:'first'}),true,now),second={...first,startFold:'second' as const};expect(agendaCutoff(second)!-agendaCutoff(first)!).toBe(3600000);
  expect(()=>validateAgendaInput(input({startDate:'2027-10-31',endTime:'02:30'}),true,now)).toThrow(AgendaValidationError);
  expect(()=>validateAgendaInput(input({startDate:'2027-11-01',startTime:'02:30',reminders:[{id:randomUUID(),unit:'days',value:1,sendTime:null}]}),true,now)).toThrow(AgendaValidationError);
 });
 it('compares resolved start against end even at the double hour',()=>{
  expect(()=>validateAgendaInput(input({startDate:'2027-10-31',startTime:'02:30',startFold:'second',endTime:'02:10'}),true,now)).toThrow(AgendaValidationError);
  expect(()=>validateAgendaInput(input({startDate:'2027-10-31',startTime:'02:30',startFold:'second',endTime:'03:00'}),true,now)).not.toThrow();
 });
 it('permits end time without start time and keeps the untimed first-day cutoff',()=>{
  const f=validateAgendaInput(input({startDate:'2027-04-05',endDate:'2027-04-12',endTime:'17:30'}),true,now);expect(computeAgendaTiming(f,now).startAt).toBeNull();expect(new Date(agendaCutoff(f)!).toISOString()).toBe('2027-04-05T22:00:00.000Z');
  expect(agendaCutoff({...f,startDate:'2027-03-28',endDate:null,endTime:null})!-resolveParisLocal('2027-03-28','00:00')).toBe(23*3600000);
 });
 it('does not generate reminders for undated ideas or silently correct invalid time',()=>{
  expect(computeAgendaTiming(validateAgendaInput(input(),true,now),now).reminderSchedule).toEqual([]);
  for(const extra of [{startDate:'2027-02-30'},{startDate:'2027-03-28',startTime:'02:30'},{startDate:'2027-04-05',reminders:[{id:randomUUID(),unit:'hours',value:2,sendTime:null}]},{endTime:'17:00'}])expect(()=>validateAgendaInput(input(extra),true,now)).toThrow(AgendaValidationError);
 });
 it('uses text member IDs, opaque kept document links and rejects malformed/over-limit bodies',()=>{
  const kept=randomUUID();expect(validateAgendaInput(input({shareMode:'selected',readerIds:['better-auth-text-user'],retainedDocumentLinkIds:[kept]}),true,now).retainedDocumentLinkIds).toEqual([kept]);
  for(const extra of [{title:'x'.repeat(201)},{readerIds:['same','same']},{links:[{label:'x',url:'javascript:alert(1)'}]},{reminders:[{id:randomUUID(),unit:'days',value:Infinity,sendTime:'18:00'}]},{endFold:'second'}])expect(()=>validateAgendaInput(input(extra),true,now)).toThrow(AgendaValidationError);
 });
 it('classifies a newly configured past reminder without implicit sending',()=>{
  const f=validateAgendaInput(input({startDate:'2027-01-01',startTime:'11:00',reminders:[{id:randomUUID(),unit:'hours',value:1,sendTime:null}]}),true,now);expect(computeAgendaTiming(f,now).reminderSchedule[0].state).toBe('past');
 });
 it('rejects zero hours, over-365 offsets and an impossible at-cutoff reminder, keeping same-day untimed valid',()=>{
  for(const reminder of [{unit:'hours',value:0,sendTime:null},{unit:'days',value:366,sendTime:null},{unit:'days',value:0,sendTime:null}])expect(()=>validateAgendaInput(input({startDate:'2027-04-05',startTime:'15:00',reminders:[{id:randomUUID(),...reminder}]}),true,now)).toThrow(AgendaValidationError);
  expect(()=>validateAgendaInput(input({startDate:'2027-04-05',reminders:[{id:randomUUID(),unit:'days',value:0,sendTime:'18:00'}]}),true,now)).not.toThrow();
 });
 it('rejects unknown/repeated filters and requires a day for daily projection',()=>{
  for(const q of ['?view=day','?view=list&limit=0','?day=2027-02-30','?view=list&view=archives','?personId=someone'])expect(()=>validateAgendaList(new Request('https://synthetic.invalid/api/hestia/agenda'+q))).toThrow();
  expect(validateAgendaList(new Request('https://synthetic.invalid/api/hestia/agenda?view=day&day=2027-04-05')).day).toBe('2027-04-05');
 });
});
