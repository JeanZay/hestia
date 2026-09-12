import { expect, test } from "@playwright/test";

test("coffre : recherche, catégorie, détail et original synthétique", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Le quotidien, à sa place." })).toBeVisible();
  await expect(page.getByText("100 % synthétiques", { exact: false })).toBeVisible();
  await page.getByRole("searchbox", { name: "Rechercher un document" }).fill("ELECTRICITE");
  await expect(page.getByRole("button", { name: "Voir Facture d’énergie · septembre" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Voir Attestation du foyer" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Facture d’énergie · septembre", exact: true })).toBeVisible();
  const original = page.getByRole("link", { name: "Ouvrir l’original synthétique" });
  await expect(original).toHaveAttribute("href", "/demo/energie-septembre.txt");
  const response = await request.get((await original.getAttribute("href"))!);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("DOCUMENT ENTIÈREMENT SYNTHÉTIQUE");
  await page.getByRole("button", { name: "Administratif", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aucun document trouvé" })).toBeVisible();
  await page.getByRole("button", { name: "Effacer les filtres" }).click();
  await expect(page.getByRole("button", { name: /^Voir / })).toHaveCount(4);
});

test("validation : décision explicite, provenance conservée et réinitialisation au rechargement", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "À valider", exact: true }).click();
  const confirm = page.getByRole("button", { name: "Confirmer la valeur" });
  await expect(confirm).toBeDisabled();
  await expect(page.getByText("28 ou 29 septembre 2026", { exact: false })).toBeVisible();
  await page.getByRole("checkbox", { name: /J’ai vérifié la source/ }).check();
  await confirm.click();
  await expect(page.getByText("Validée dans cette session", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tout est à jour pour cette démo." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ouvrir l’original synthétique" })).toHaveAttribute("href", "/demo/mediatheque.txt");
  await expect(page.getByText("28 ou 29 septembre 2026", { exact: false })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "À valider", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirmer la valeur" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /J’ai vérifié la source/ })).not.toBeChecked();
});

test("refuser une proposition conserve la source et bloque la valeur", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "À valider", exact: true }).click();
  await page.getByRole("button", { name: "Écarter la proposition" }).click();
  await expect(page.getByText("Proposition écartée", { exact: true })).toBeVisible();
  await expect(page.getByText("Cette valeur ne peut pas être utilisée.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ouvrir l’original synthétique" })).toHaveAttribute("href", "/demo/mediatheque.txt");
  await page.getByRole("button", { name: "Le coffre", exact: true }).click();
  await page.getByRole("button", { name: "Voir Inscription à la médiathèque" }).click();
  await expect(page.getByText("Cette valeur n’est pas utilisée.", { exact: true })).toBeVisible();
});

test("connecteurs : pause globale par défaut, permissions, erreur et désactivation individuelle", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connecteurs", exact: true }).click();
  const circuit = page.getByRole("switch", { name: "Coupe-circuit global", exact: true });
  const files = page.getByRole("article", { name: "Boîte de dépôt", exact: true });
  const sync = files.getByRole("button", { name: "Simuler une synchronisation" });
  await expect(circuit).toBeChecked();
  await expect(sync).toBeDisabled();
  await expect(files.getByText("Lire les fichiers déposés")).toBeVisible();
  await expect(page.getByText("Exemple d’erreur : autorisation caméra refusée.")).toBeVisible();
  await circuit.click();
  await expect(sync).toBeEnabled();
  await sync.click();
  await expect(files.getByText("À l’instant · simulation locale")).toBeVisible();
  const email = page.getByRole("article", { name: "Pièces jointes e-mail", exact: true });
  await email.getByRole("switch", { name: "Pièces jointes e-mail", exact: true }).click();
  await expect(email.getByText("Non configuré", { exact: true })).toBeVisible();
  await expect(email.getByRole("button", { name: "Simuler une synchronisation" })).toBeDisabled();
  await files.getByRole("switch", { name: "Boîte de dépôt", exact: true }).click();
  await expect(sync).toBeDisabled();
  await circuit.click();
  await files.getByRole("switch", { name: "Boîte de dépôt", exact: true }).click();
  await expect(sync).toBeDisabled();
  await expect(page.getByRole("article", { name: "Photo et scan mobile" }).getByRole("button", { name: "Simuler une synchronisation" })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "Connecteurs", exact: true }).click();
  await expect(circuit).toBeChecked();
});

test("charger un exemple local ne crée ni upload, ni stockage navigateur, ni requête externe", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:3210") external.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Charger un exemple", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Voir / })).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Atelier jardin en famille", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exemple ajouté", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Connecteurs", exact: true }).click();
  await page.getByRole("switch", { name: "Coupe-circuit global", exact: true }).click();
  await page.getByRole("article", { name: "Boîte de dépôt", exact: true }).getByRole("button", { name: "Simuler une synchronisation" }).click();
  await expect(page.getByRole("status")).toContainText("Aucun service externe contacté");
  expect(external).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie }))).toEqual({ local: 0, session: 0, cookies: "" });
  await page.reload();
  await expect(page.getByRole("button", { name: /^Voir / })).toHaveCount(4);
});

test("l’interface reste contenue dans l’écran et le service annonce ses limites", async ({ page, request }) => {
  await page.goto("/");
  for (const name of ["Le coffre", "À valider", "Connecteurs"]) {
    await page.getByRole("button", { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const captureName = name === "Le coffre" ? "vault" : name === "À valider" ? "review" : "connectors";
    await page.screenshot({ path: test.info().outputPath(`${captureName}.png`), fullPage: true });
  }
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(health.headers()["cache-control"]).toBe("no-store");
  expect(await health.json()).toMatchObject({ status: "ok", mode: "demo", synthetic: true, persistence: false });
});
