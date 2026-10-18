import { expect, test, type Page } from '@playwright/test';
import type { DocumentSummaryDto } from '../../src/shared/inbox-contract';

const folder={id:'summary-folder',name:'Maison',version:1,capabilities:['consulter','exporter'],documentCount:1,visibleParentId:null,breadcrumbs:[{id:'summary-folder',name:'Maison'}],childCount:0,canShare:false,canAdminister:false,createdAt:'2026-10-18T10:00:00Z',createdByName:'Camille'};
const longSummary=Array.from('🧾 Facture synthétique d’entretien de la chaudière : contrôle annuel, nettoyage et pièces remplacées. Le document indique la date de visite, le montant total et les coordonnées de l’Atelier Démo. Référence du contrat du foyer.').slice(0,200).join('');
const longTitle=Array.from('Contrat synthétique d’entretien de la chaudière de la maison et justificatif détaillé des interventions annuelles avec les références des pièces remplacées et les conditions de garantie conservées par le foyer.').slice(0,200).join('');
const documentFixture=(summary:DocumentSummaryDto)=>({id:'summary-doc',folderId:folder.id,title:'Entretien synthétique',fileName:'entretien.pdf',mediaType:'application/pdf',size:1400,sha256:'a'.repeat(64),createdAt:'2026-10-18T10:00:00Z',uploadedByName:'Camille',source:'import',version:1,revisionId:'revision-one',previewSupported:false,capabilities:folder.capabilities,summary});
async function setup(page:Page,initial:DocumentSummaryDto={status:'ready',text:longSummary},title='Entretien synthétique') {
  let document={...documentFixture(initial),title},visible=true;
  const writes:string[]=[],workspaceActivity:(string|undefined)[]=[];
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()!=='GET')writes.push(`${request.method()} ${url.pathname}`);
    if(url.pathname==='/api/hestia/workspace') {
      workspaceActivity.push(request.headers()['x-hestia-activity']);
      const q=url.searchParams.get('q'),selected=url.searchParams.has('folderId');
      const matches=q!==null?`${document.title} ${document.fileName} ${folder.name}`.toLowerCase().includes(q.toLowerCase()):selected;
      return route.fulfill({json:{user:{id:'summary-actor',name:'Camille',email:'camille@example.invalid',role:'owner'},folders:[folder],selectedFolder:selected?folder:null,documents:visible&&matches?[document]:[],now:new Date().toISOString()}});
    }
    if(url.pathname==='/api/hestia/inbox')return route.fulfill({json:{pendingCount:0,messages:[],attachments:[],receptionAvailable:true}});
    if(url.pathname==='/api/hestia/documents/summary-doc/versions')return route.fulfill({json:{version:document.version,now:new Date().toISOString(),versions:[]}});
    if(url.pathname==='/api/hestia/documents/summary-doc')return route.fulfill({json:{document}});
    return route.fulfill({json:{}});
  });
  await page.goto('/');
  await page.getByRole('main').getByRole('button',{name:/^Maison /}).click();
  await expect(page.getByRole('button',{name:document.title,exact:true})).toBeVisible();
  return {writes,workspaceActivity,summary:(summary:DocumentSummaryDto)=>{document={...document,summary};},replace:()=>{document={...document,version:2,revisionId:'revision-two',sha256:'b'.repeat(64),summary:{status:'ready',text:'Résumé de la nouvelle version.'}};},revoke:()=>{visible=false;}};
}

test('P28 garde 200 Unicode complets, ordre, description accessible et zoom sans troncature',async({page,isMobile})=>{
  const state=await setup(page,{status:'ready',text:longSummary},longTitle);
  if(isMobile)await page.setViewportSize({width:390,height:844});
  const row=page.locator('.h-summary-row'),title=row.getByRole('button',{name:longTitle,exact:true});
  expect(Array.from(longTitle)).toHaveLength(200);
  expect(Array.from(longSummary)).toHaveLength(200);
  await expect(title).toHaveAccessibleDescription(new RegExp('Résumé IA :'));
  expect(await row.locator('.h-summary-text').textContent()).toBe(`Résumé IA : ${longSummary}`);
  expect(await row.locator('.h-summary-title').evaluate(e=>getComputedStyle(e).fontSize)).toBe('16px');
  expect(await row.locator('.h-summary-text').evaluate(e=>getComputedStyle(e).fontSize)).toBe('15px');
  expect(await row.locator('.h-summary-meta').evaluate(e=>getComputedStyle(e).fontSize)).toBe('14px');
  expect(await page.locator('.h-summary-note').count()).toBe(1);
  expect(await row.locator('button button').count()).toBe(0);
  await page.screenshot({path:test.info().outputPath('summary-list.png'),fullPage:true});
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%';document.body.style.zoom='2';});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(await row.locator('.h-summary-text').evaluate(e=>getComputedStyle(e).overflow)).toBe('visible');
  await page.screenshot({path:test.info().outputPath('summary-zoom.png'),fullPage:true});
  expect(state.writes).toEqual([]);
});

test('historique → prévu → prêt sans réouverture ni vol du focus et accès retiré après prêt',async({page})=>{
  await page.clock.install();
  const state=await setup(page,{status:'none'});
  const title=page.getByRole('button',{name:'Entretien synthétique',exact:true});
  await title.focus();
  state.summary({status:'pending'});
  await page.clock.fastForward(15100);
  await expect(page.getByText('Résumé prévu',{exact:true})).toBeVisible();
  await expect(title).toBeFocused();
  state.summary({status:'ready',text:'Résumé arrivé sans ouvrir.'});
  await page.clock.fastForward(15100);
  await expect(page.getByText('Résumé arrivé sans ouvrir.',{exact:false})).toBeVisible();
  await expect(title).toBeFocused();
  expect(state.workspaceActivity.at(-1)).toBeUndefined();
  await title.press('Enter');
  const panel=page.getByRole('complementary',{name:'Document',exact:true});
  await expect(panel.getByText('Résumé arrivé sans ouvrir.',{exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('summary-detail.png'),fullPage:true});
  state.replace();
  await page.clock.fastForward(15100);
  await expect(panel.getByText('Résumé de la nouvelle version.',{exact:true})).toBeVisible();
  await expect(panel.getByText('Résumé arrivé sans ouvrir.',{exact:true})).toHaveCount(0);
  state.revoke();
  await page.clock.fastForward(15100);
  await expect(panel.getByText('Document indisponible',{exact:true})).toBeVisible();
  await expect(page.getByText('Résumé de la nouvelle version.',{exact:false})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Entretien synthétique',exact:true})).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('recherche lexicalement bornée, chemin visible et aucun résultat dans les résumés',async({page,isMobile})=>{
  const state=await setup(page,{status:'ready',text:'Pièces remplacées du vélo synthétique.'});
  if(isMobile)await page.getByRole('button',{name:'Rechercher',exact:true}).click();
  const search=isMobile?page.getByRole('searchbox',{name:'Rechercher',exact:true}):page.getByRole('searchbox',{name:'Rechercher un document ou un dossier',exact:true});
  await search.fill('entretien');
  await expect(page.getByRole('button',{name:'Entretien synthétique',exact:true})).toBeVisible();
  await expect(page.locator('.h-summary-meta')).toContainText('Maison');
  await expect(page.getByText('Titres, noms de fichiers et dossiers. Les résumés ne sont pas pris en compte.',{exact:true})).toBeVisible();
  await search.fill('pièces');
  await expect(page.getByRole('heading',{name:'Aucun résultat',exact:true})).toBeVisible();
  await expect(page.getByText('La recherche porte sur les titres, noms de fichiers et dossiers auxquels vous avez accès. Les résumés ne sont pas pris en compte. Les documents à la corbeille n’apparaissent pas.',{exact:true})).toBeVisible();
  expect(state.writes).toEqual([]);
});
