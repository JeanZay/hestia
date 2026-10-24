import {expect,test,type Page} from '@playwright/test';
import type {AgendaCard,AgendaMutationInput} from '../../src/shared/agenda-contract';
import {emptyAgendaFields} from '../../src/components/hestia/agenda-client';
const cardId='11111111-1111-4111-8111-111111111111';
const fixture=():AgendaCard=>({...emptyAgendaFields('2027-10-31'),startTime:'02:30',startFold:'first',id:cardId,title:'Sortie synthétique',revision:1,creator:{id:'camille',name:'Camille',departed:false},canManage:true,archived:false,audience:{mode:'all',summary:'household'},documents:[{linkId:'opaque',state:'unavailable'}],reminders:[],reminderSummary:{count:0,receives:false},createdAt:'2026-10-19T00:00:00Z',updatedAt:'2026-10-19T00:00:00Z'});
async function setup(page:Page,{existing=false,lost=false,conflict=false,deep=false,depositOnly=false}:{existing?:boolean;lost?:boolean;conflict?:boolean;deep?:boolean;depositOnly?:boolean}={}){
  let server:AgendaCard|null=existing?fixture():null,firstLost=lost,nextConflict=conflict,denied=false;const writes:AgendaMutationInput[]=[];
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',headers:(path.startsWith('/api/hestia/agenda')||path==='/api/hestia/transcriptions')?{'X-Hestia-Actor':'camille'}:{},body:JSON.stringify(body)});
    if(path==='/api/hestia/workspace')return json({user:{id:'camille',name:'Camille',email:'camille@hestia.invalid',role:'owner'},folders:depositOnly?[{id:'folder-one',name:'Dépôt synthétique',version:1,capabilities:['déposer'],documentCount:0,childCount:0,visibleParentId:null,breadcrumbs:[],createdAt:'2026-10-19T00:00:00Z',createdByName:'Alex'}]:[],selectedFolder:null,documents:[],now:new Date().toISOString()});
    if(path==='/api/hestia/outgoing')return json({draft:null,service:{configured:false,reason:'not-configured',sender:{name:'Hestia',email:null},replyTo:'camille@hestia.invalid',limits:{documents:20,bytes:20000000,recipients:20}}});
    if(path==='/api/hestia/uploads')return json({operation:{id:'upload-one',status:'completed',chunkSize:1024}});
    if(path==='/api/hestia/uploads/upload-one/complete')return json({document:null});
    if(path==='/api/hestia/inbox')return json({pendingCount:0,messages:[],attachments:[]});
    if(path==='/api/hestia/transcriptions')return json({enabled:false,available:false,reason:'disabled'});
    if(path==='/api/hestia/agenda/members')return json({members:[{id:'camille',name:'Camille'},{id:'alex',name:'Alex'}]});
    if(path==='/api/hestia/agenda/available-documents')return json({documents:[],nextOffset:null});
    if(path.startsWith('/api/hestia/agenda/operations/'))return json({requestId:path.split('/').pop(),status:'not-recorded'});
    if(path==='/api/hestia/agenda'&&req.method()==='GET')return json({cards:server?[server]:[],total:server?1:0,filteredTotal:server?1:0,categories:[],nextOffset:null,day:url.searchParams.get('day'),today:'2026-10-19',householdTimeZone:'Europe/Paris'});
    if(path==='/api/hestia/agenda'&&req.method()==='POST'||path===`/api/hestia/agenda/${cardId}`&&req.method()==='PATCH'){
      const input=req.postDataJSON() as AgendaMutationInput;writes.push(input);
      if(firstLost){firstLost=false;return route.abort('failed');}
      if(nextConflict&&server){nextConflict=false;server={...server,title:'Version autre appareil',revision:2,startFold:'second'};return json({error:{code:'AGENDA_CONFLICT',message:'La fiche a changé.'},current:server},409);}
      if(server&&input.revision!==server.revision)return json({error:{code:'AGENDA_CONFLICT',message:'La fiche a changé.'},current:server},409);
      server={...fixture(),...input,id:cardId,revision:(server?.revision??0)+1,documents:[],reminders:input.reminders.map(r=>({...r,state:'scheduled',sendAt:null})),reminderSummary:{count:input.reminders.length,receives:input.reminders.length>0}};
      return json({card:server,operation:{requestId:input.requestId,status:'committed',cardId,revision:server.revision}});
    }
    if(path===`/api/hestia/agenda/${cardId}`){if(denied||!server)return json({error:{code:'UNAVAILABLE',message:'Fiche indisponible.'}},404);return json({card:server});}
    if(path.endsWith('/archive')||path.endsWith('/reopen')){if(server)server={...server,archived:path.endsWith('/archive'),revision:server.revision+1};return json({card:server});}
    return json({});
  });
  await page.goto(deep?'/?agenda='+cardId:'/');
  await expect(page.getByRole('heading',{name:deep?'Sortie synthétique':'Dossiers',exact:true})).toBeVisible();
  return {writes,change:()=>{if(server)server={...server,revision:server.revision+1,title:'Troisième version'};},deny:()=>{denied=true;},get:()=>server};
}
async function agenda(page:Page,isMobile:boolean){await page.getByRole('navigation',{name:isMobile?'Navigation principale mobile':'Navigation principale',exact:true}).getByRole('button',{name:'Agenda',exact:true}).click();await expect(page.getByRole('heading',{name:'Agenda',exact:true})).toBeVisible();}
async function existing(page:Page,isMobile:boolean){await agenda(page,isMobile);await page.getByRole('tab',{name:'Liste',exact:true}).click();await page.getByRole('button',{name:/Sortie synthétique/}).click();await page.getByRole('button',{name:'Modifier',exact:true}).click();}

test('Les contrôles du jour restent alignés et de même hauteur',async({page,isMobile})=>{
  await setup(page);await agenda(page,isMobile);
  const widths=isMobile?[320,360,390]:[1280];
  for(const width of widths){
    await page.setViewportSize({width,height:844});
    const date=page.getByLabel('Aller au',{exact:true});
    const today=page.getByRole('button',{name:'Aujourd’hui',exact:true});
    const current=await date.inputValue();
    for(const value of [current,'2027-04-05']){
      await date.fill(value);await expect(date).toHaveValue(value);
      if(value===current)await expect(today).toBeDisabled();else await expect(today).toBeEnabled();
      const buttonBox=await today.boundingBox(),dateBox=await date.boundingBox();
      expect(buttonBox).not.toBeNull();expect(dateBox).not.toBeNull();
      expect(Math.abs(buttonBox!.height-dateBox!.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(buttonBox!.y-dateBox!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(buttonBox!.y+buttonBox!.height-dateBox!.y-dateBox!.height)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.locator('.ha-day').screenshot({path:test.info().outputPath(`agenda-controls-${width}-${value===current?'today':'other'}.png`)});
    }
    await today.click();await expect(date).toHaveValue(current);await expect(today).toBeDisabled();
  }
});

test('Créer une idée sans date garde une seule fiche sans rappel et la navigation approuvée',async({page,isMobile})=>{
  const state=await setup(page);await agenda(page,isMobile);await page.getByRole('tab',{name:'Liste',exact:true}).click();await page.getByRole('button',{name:'Nouvelle fiche',exact:true}).click();await page.getByRole('textbox',{name:'Titre',exact:true}).fill('Idée synthétique');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page.getByRole('heading',{name:'Idée synthétique',exact:true})).toBeVisible();expect(state.writes).toHaveLength(1);expect(state.writes[0]).toMatchObject({startDate:null,startTime:null,reminders:[]});
  if(isMobile){const nav=page.getByRole('navigation',{name:'Navigation principale mobile'});expect(await nav.getByRole('button').allTextContents()).toEqual(['Dossiers','Agenda','Échanges','Photo','Moi']);await expect(page.getByRole('button',{name:'Rechercher',exact:true})).toBeVisible();}else await expect(page.getByRole('searchbox',{name:'Rechercher un document ou un dossier'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('La date consultée est préremplie sans heure et une plage inclusive garde une intention',async({page,isMobile})=>{
  const state=await setup(page);await agenda(page,isMobile);await page.getByLabel('Aller au',{exact:true}).fill('2027-04-05');await page.getByRole('button',{name:'Créer pour ce jour',exact:true}).click();await expect(page.getByLabel('Début',{exact:true})).toHaveValue('2027-04-05');await expect(page.getByLabel('Heure de début',{exact:true})).toHaveValue('');await page.getByLabel('Date de fin',{exact:true}).fill('2027-04-12');await page.getByLabel('Titre',{exact:true}).fill('Plage synthétique');await page.getByRole('button',{name:'Ajouter un rappel',exact:true}).click();await expect(page.getByRole('option',{name:'Heures avant'})).toBeDisabled();await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page.getByRole('heading',{name:'Plage synthétique',exact:true})).toBeVisible();expect(state.writes[0]).toMatchObject({startDate:'2027-04-05',startTime:null,endDate:'2027-04-12'});expect(state.writes[0].reminders).toHaveLength(1);
});
test('Relecture complète conserve la saisie et revalide une troisième révision au clic final',async({page,isMobile})=>{
  const state=await setup(page,{existing:true,conflict:true});await existing(page,isMobile);await page.getByLabel('Titre',{exact:true}).fill('Ma saisie conservée');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await page.getByRole('button',{name:'Relire la version enregistrée',exact:true}).click();await expect(page.getByRole('textbox',{name:'Titre',exact:true})).toHaveValue('Ma saisie conservée');const comparison=page.getByRole('region',{name:'Comparaison complète'});await expect(comparison).toContainText('Version autre appareil');await expect(comparison).toContainText('Premier passage');await expect(comparison).toContainText('Second passage');await page.screenshot({path:test.info().outputPath('agenda-conflict-comparison.png'),fullPage:true});await page.getByRole('button',{name:'Reprendre la version enregistrée',exact:true}).click();state.change();await page.getByRole('dialog').getByRole('button',{name:'Reprendre cette version',exact:true}).click();await expect(page.getByText('Nouvelle modification enregistrée pendant votre relecture.',{exact:true})).toBeVisible();await expect(page.getByLabel('Titre',{exact:true})).toHaveValue('Ma saisie conservée');await page.getByRole('button',{name:'Relire la nouvelle version',exact:true}).click();await page.getByRole('button',{name:'Garder ma saisie',exact:true}).click();await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page.getByRole('heading',{name:'Ma saisie conservée',exact:true})).toBeVisible();expect(state.writes).toHaveLength(2);expect(state.writes[1].revision).toBe(3);
  await page.screenshot({path:test.info().outputPath('agenda-conflict-integrated.png'),fullPage:true});
});
test('Réponse perdue et reçu absent ne créent jamais une seconde intention',async({page,isMobile})=>{
  const state=await setup(page,{lost:true});await agenda(page,isMobile);await page.getByRole('button',{name:'Créer pour ce jour',exact:true}).click();await page.getByLabel('Titre',{exact:true}).fill('Enregistrement perdu');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await page.getByRole('button',{name:'Vérifier le résultat',exact:true}).click();await page.getByRole('button',{name:'Réessayer la même opération',exact:true}).click();await expect(page.getByRole('heading',{name:'Enregistrement perdu',exact:true})).toBeVisible();expect(state.writes).toHaveLength(2);expect(state.writes[0]).toEqual(state.writes[1]);
});
test('Le lien authentifié ne révèle aucune PJ indisponible puis une perte de droits masque la fiche',async({page})=>{
  const state=await setup(page,{existing:true,deep:true});await expect(page.getByText('Document indisponible',{exact:true})).toBeVisible();await expect(page).not.toHaveURL(/agenda=/);state.deny();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('heading',{name:'Fiche indisponible',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Sortie synthétique',exact:true})).toHaveCount(0);
});
test('Quitter une saisie via la navigation demande le dialogue existant et peut conserver le formulaire',async({page,isMobile})=>{
  await setup(page);await agenda(page,isMobile);await page.getByRole('button',{name:'Créer pour ce jour',exact:true}).click();await page.getByLabel('Titre',{exact:true}).fill('À conserver');const nav=page.getByRole('navigation',{name:isMobile?'Navigation principale mobile':'Navigation principale',exact:true});await nav.getByRole('button',{name:isMobile?'Dossiers':'Tous les dossiers',exact:true}).click();await expect(page.getByRole('dialog',{name:'Abandonner la nouvelle fiche ?'})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'Continuer la saisie',exact:true}).click();await expect(page.getByLabel('Titre',{exact:true})).toHaveValue('À conserver');await nav.getByRole('button',{name:isMobile?'Dossiers':'Tous les dossiers',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Abandonner',exact:true}).click();await expect(page.getByRole('heading',{name:'Dossiers',exact:true})).toBeVisible();
});
test('Un dépôt finalisé sans Consulter est associé par jeton opaque sans métadonnée inventée',async({page,isMobile})=>{
  const state=await setup(page,{depositOnly:true});await agenda(page,isMobile);await page.getByRole('button',{name:'Créer pour ce jour',exact:true}).click();await page.getByLabel('Titre',{exact:true}).fill('Fiche dépôt opaque');await page.getByRole('button',{name:'Ajouter un fichier',exact:true}).click();await page.getByLabel('Dossier où le conserver',{exact:true}).selectOption('folder-one');await page.getByLabel('Fichier',{exact:true}).setInputFiles({name:'opaque-synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic')});await page.getByRole('button',{name:'Déposer et associer',exact:true}).click();await expect(page.getByText('Document indisponible',{exact:true})).toBeVisible();await expect(page.getByText('opaque-synthetic.pdf',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page.getByRole('heading',{name:'Fiche dépôt opaque',exact:true})).toBeVisible();expect(state.writes[0]).toMatchObject({documentIds:[],completedUploadIds:['upload-one']});
});

test('API RÉELLE du banc possédé : créer, retrouver chaque jour, archiver et réouvrir',async({page,isMobile})=>{
  const password=process.env.HESTIA_TEST_PASSWORD;
  if(!password||process.env.HESTIA_ENVIRONMENT!=='local')throw new Error('Use the owned synthetic E2E bench.');
  // No interception of authentication or business routes in this scenario.
  await page.goto('/');
  for(let attempt=0;attempt<4;attempt++){
    await page.getByLabel('Adresse e-mail').fill('camille@hestia.invalid');await page.getByLabel('Mot de passe',{exact:true}).fill(password);
    const received=page.waitForResponse(r=>r.url().endsWith('/api/auth/sign-in/email'));await page.getByRole('button',{name:'Se connecter',exact:true}).click();const result=await received;
    if(result.status()!==429){expect(result.status()).toBe(200);break;}await page.waitForTimeout(10100);
  }
  await expect(page.getByRole('heading',{name:'Dossiers',exact:true})).toBeVisible();await agenda(page,isMobile);
  await page.getByLabel('Aller au',{exact:true}).fill('2027-04-05');await page.getByRole('button',{name:'Créer pour ce jour',exact:true}).click();
  const title='Agenda banc '+crypto.randomUUID().slice(0,8);await page.getByLabel('Titre',{exact:true}).fill(title);await page.getByLabel('Date de fin',{exact:true}).fill('2027-04-12');
  const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/hestia/agenda'&&r.request().method()==='POST');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();const result=await created;expect(result.status()).toBe(201);const body=await result.json();expect(body.card).toMatchObject({title,startDate:'2027-04-05',startTime:null,endDate:'2027-04-12'});
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();await page.getByRole('button',{name:'Retour à l’agenda',exact:true}).click();await page.getByRole('tab',{name:'Liste',exact:true}).click();await expect(page.getByRole('button',{name:new RegExp(title)})).toBeVisible();await page.getByRole('tab',{name:'Jour',exact:true}).click();await page.getByLabel('Aller au',{exact:true}).fill('2027-04-06');await page.getByRole('button',{name:new RegExp(title)}).click();
  await page.getByRole('button',{name:'Archiver',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Archiver',exact:true}).click();await expect(page.getByText(/Créé par Camille · Archivée/)).toBeVisible();await page.getByRole('button',{name:'Retour à l’agenda',exact:true}).click();await expect(page.getByRole('button',{name:new RegExp(title)})).toHaveCount(0);await page.getByRole('tab',{name:'Archives',exact:true}).click();await page.getByRole('button',{name:new RegExp(title)}).click();await page.getByRole('button',{name:'Réouvrir',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Réouvrir',exact:true}).click();await expect(page.getByRole('button',{name:'Modifier',exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('agenda-real-api-detail.png'),fullPage:true});
});

for(const target of ['existing','new']as const)test('Une ancienne lecture A ne remplace pas la destination '+target,async({page})=>{
  await setup(page,{existing:true,deep:true});const b={...fixture(),id:'22222222-2222-4222-8222-222222222222',title:'Fiche B'};
  let release!:()=>void,held=false;const waiting=new Promise<void>(resolve=>{release=resolve;});const writes:{path:string;input:AgendaMutationInput}[]=[];
  await page.route('**/api/hestia/agenda**',async route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname;const json=(body:unknown)=>route.fulfill({contentType:'application/json',headers:{'X-Hestia-Actor':'camille'},body:JSON.stringify(body)});
    if(path==='/api/hestia/agenda/'+cardId&&req.method()==='GET'){held=true;await waiting;return json({card:fixture()});}
    if(path==='/api/hestia/agenda/'+b.id&&req.method()==='GET')return json({card:b});
    if(path==='/api/hestia/agenda'&&req.method()==='GET')return json({cards:[fixture(),b],total:2,filteredTotal:2,categories:[],nextOffset:null,today:'2026-10-19',householdTimeZone:'Europe/Paris'});
    if(['PATCH','POST'].includes(req.method())){const input=req.postDataJSON()as AgendaMutationInput;writes.push({path,input});return json({card:{...b,...input,revision:2},operation:{status:'committed'}});}return route.fallback();
  });
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>held).toBe(true);await page.getByRole('button',{name:'Retour à l’agenda',exact:true}).click();await page.getByRole('tab',{name:'Liste',exact:true}).click();
  if(target==='existing'){await page.getByRole('button',{name:/Fiche B/}).click();await page.getByRole('button',{name:'Modifier',exact:true}).click();}else await page.getByRole('button',{name:'Nouvelle fiche',exact:true}).click();
  await page.getByLabel('Titre',{exact:true}).fill('Saisie destination conservée');const completed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/hestia/agenda/'+cardId);release();await completed;
  await expect(page.getByLabel('Titre',{exact:true})).toHaveValue('Saisie destination conservée');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page.getByRole('heading',{name:'Saisie destination conservée',exact:true})).toBeVisible();expect(writes).toHaveLength(1);expect(writes[0].path).toBe('/api/hestia/agenda'+(target==='existing'?'/'+b.id:''));expect(writes[0].input.revision).toBe(target==='existing'?1:0);
});
test('Deux lectures inversées ne ressuscitent jamais les métadonnées révoquées',async({page})=>{
  await setup(page,{existing:true,deep:true});let count=0,release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/hestia/agenda/'+cardId,async route=>{const first=++count===1;if(first)await waiting;return route.fulfill({contentType:'application/json',headers:{'X-Hestia-Actor':'camille'},body:JSON.stringify({card:{...fixture(),documents:first?[{linkId:'opaque',state:'available',documentId:'private-doc',title:'Titre privé révoqué',path:'Chemin privé',fileName:'privé.pdf',canDownload:true}]:[{linkId:'opaque',state:'unavailable'}]}})});});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>count).toBe(1);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>count).toBe(2);await expect(page.getByText('Document indisponible',{exact:true})).toBeVisible();const completed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/hestia/agenda/'+cardId);release();await completed;await expect(page.getByText('Titre privé révoqué',{exact:true})).toHaveCount(0);await expect(page.getByText('Document indisponible',{exact:true})).toBeVisible();
});
test('La panne initiale des membres peut être réessayée sans perdre la saisie',async({page,isMobile})=>{
  let attempts=0;
  await setup(page);await page.route('**/api/hestia/agenda/members',route=>{attempts++;return route.fulfill({status:attempts===1?503:200,contentType:'application/json',headers:{'X-Hestia-Actor':'camille'},body:JSON.stringify(attempts===1?{error:{message:'Lecture temporairement impossible.'}}:{members:[{id:'camille',name:'Camille'}]})});});
  await agenda(page,isMobile);await expect.poll(()=>attempts).toBe(1);await page.getByRole('button',{name:'Créer pour ce jour',exact:true}).click();await page.getByLabel('Titre',{exact:true}).fill('Saisie après panne');await expect(page.getByRole('button',{name:'Enregistrer',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Réessayer',exact:true}).click();await expect(page.getByRole('button',{name:'Enregistrer',exact:true})).toBeEnabled();await expect(page.getByLabel('Titre',{exact:true})).toHaveValue('Saisie après panne');
});

test('Créer pendant une liste lente quitte son chargement et ignore son retour',async({page,isMobile})=>{
  await setup(page);let release!:()=>void,held=false;const waiting=new Promise<void>(resolve=>{release=resolve;});await page.route('**/api/hestia/agenda?*',async route=>{held=true;await waiting;return route.fallback();});await agenda(page,isMobile);await expect.poll(()=>held).toBe(true);await page.getByRole('button',{name:'Créer pour ce jour',exact:true}).click();await expect(page.getByLabel('Titre',{exact:true})).toBeVisible();await page.getByLabel('Titre',{exact:true}).fill('Formulaire avant liste');release();await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page.getByRole('heading',{name:'Formulaire avant liste',exact:true})).toBeVisible();
});
