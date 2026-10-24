import { expect, test } from "@playwright/test";
import { login } from "../qualification/comment-voice/helpers";

for (const actor of ["camille", "alex"]) test(`Brouillons : retour vers Moi par le profil et le rail (${actor})`, async ({ page, isMobile }) => {
  await login(page, `${actor}@hestia.invalid`);
  const main = page.getByRole("main");
  const writes: string[] = [];
  page.on("request", request => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/hestia/")) writes.push(request.method());
  });
  await page.getByRole("navigation", { name: isMobile ? "Navigation principale mobile" : "Navigation principale", exact: true }).getByRole("button", { name: "Moi", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Moi", exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Brouillons", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Brouillons", exact: true })).toBeVisible();
  const back = main.getByRole("button", { name: "Moi", exact: true });
  await expect(back).toBeVisible();
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("heading", { name: "Moi", exact: true })).toBeFocused();
  await expect(main.getByRole("button", { name: "Brouillons", exact: true })).toBeVisible();
  if (!isMobile) {
    const nav = page.getByRole("navigation", { name: "Navigation principale", exact: true });
    await nav.getByRole("button", { name: /^(Tous les dossiers|Dossiers)$/ }).click();
    await expect(main.getByRole("heading", { name: "Dossiers", exact: true })).toBeVisible();
    await nav.getByRole("button", { name: "Brouillons", exact: true }).click();
    await expect(main.getByRole("heading", { name: "Brouillons", exact: true })).toBeVisible();
    await back.click();
    await expect(main.getByRole("heading", { name: "Moi", exact: true })).toBeFocused();
  }
  expect(writes).toEqual([]);
});

test("Réglages de Moi : les retours existants restent utilisables", async ({ page, isMobile }) => {
  await login(page, "alex@hestia.invalid");
  const main = page.getByRole("main");
  await page.getByRole("navigation", { name: isMobile ? "Navigation principale mobile" : "Navigation principale", exact: true }).getByRole("button", { name: "Moi", exact: true }).click();
  for (const title of ["Suggestions de rangement (IA)", "Dictée"]) {
    await main.getByRole("button", { name: title, exact: true }).click();
    await expect(main.getByRole("heading", { name: title === "Dictée" ? title : "Suggestions de rangement", exact: true })).toBeVisible();
    await main.getByRole("button", { name: "Moi", exact: true }).click();
    await expect(main.getByRole("heading", { name: "Moi", exact: true })).toBeFocused();
  }
});

test("Photo : retour supérieur vers Dossiers sans ouvrir le sélecteur", async ({ page, isMobile }) => {
  test.skip(!isMobile, "L’entrée Photo est réservée aux appareils mobiles.");
  await login(page);
  let pickers = 0;
  page.on("filechooser", () => { pickers++; });
  const main = page.getByRole("main");
  await page.getByRole("navigation", { name: "Navigation principale mobile", exact: true }).getByRole("button", { name: "Photo", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Photo", exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Dossiers", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Dossiers", exact: true })).toBeFocused();
  expect(pickers).toBe(0);
});

for (const actor of ["camille", "alex"]) test(`Photo : une seule section sélectionnée depuis chaque destination (${actor})`, async ({ page, isMobile }) => {
  test.skip(!isMobile, "L’entrée Photo est réservée aux appareils mobiles.");
  await login(page, `${actor}@hestia.invalid`);
  const nav = page.getByRole("navigation", { name: "Navigation principale mobile", exact: true });
  const main = page.getByRole("main");
  const writes: string[] = [];
  let pickers = 0;
  page.on("filechooser", () => { pickers++; });
  page.on("request", request => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/hestia/")) writes.push(request.method());
  });
  const destinations = ["Dossiers", "Échanges", "Rechercher", "Corbeille", "Moi"];
  await nav.getByRole("button", { name: "Moi", exact: true }).click();
  await main.getByRole("heading", { name: "Moi", exact: true }).waitFor({ state: "visible" });
  if (await main.getByRole("button", { name: "Foyer", exact: true }).isVisible()) destinations.push("Foyer");
  for (const destination of destinations) {
    if (destination === "Rechercher") await page.getByRole("banner").getByRole("button", { name: "Rechercher", exact: true }).click();
    else if (destination === "Corbeille" || destination === "Foyer") {
      await nav.getByRole("button", { name: "Moi", exact: true }).click();
      await main.getByRole("button", { name: destination, exact: true }).click();
    } else await nav.getByRole("button", { name: destination, exact: true }).click();
    if (destination === "Rechercher") await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
    else await expect(nav.locator('[aria-current="page"]')).toHaveText([destination === "Corbeille" || destination === "Foyer" ? "Moi" : destination]);
    await nav.getByRole("button", { name: "Photo", exact: true }).click();
    await expect(main.getByRole("heading", { name: "Photo", exact: true })).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveText(["Photo"]);
    await page.setViewportSize({ width: 1024, height: 900 });
    const rail = page.getByRole("navigation", { name: "Navigation principale", exact: true });
    await expect(rail.locator('[aria-current="page"]')).toHaveText(["Photo"]);
    await page.setViewportSize({ width: 390, height: 844 });
    await main.getByRole("button", { name: "Dossiers", exact: true }).click();
    await expect(main.getByRole("heading", { name: "Dossiers", exact: true })).toBeFocused();
    await expect(nav.locator('[aria-current="page"]')).toHaveText(["Dossiers"]);
  }
  expect(pickers).toBe(0);
  expect(writes).toEqual([]);
});
