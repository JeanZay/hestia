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
