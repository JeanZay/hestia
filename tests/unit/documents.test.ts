import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decideProposal, mayUseProposal, searchDocuments } from "../../src/domain/documents";
import type { FactProposal } from "../../src/domain/documents";
import { extraDocument, initialDocuments } from "../../src/domain/fixtures";

const pendingProposal = initialDocuments.find((document) => document.proposal)?.proposal as FactProposal;

describe("recherche locale", () => {
  it("trouve un document sans exiger les accents ni la casse", () => {
    expect(searchDocuments(initialDocuments, "  ELECTRICITE  ").map((document) => document.id)).toEqual(["energy"]);
    expect(searchDocuments(initialDocuments, "mediatheque").map((document) => document.id)).toEqual(["library"]);
  });

  it("combine tous les termes et respecte le filtre de catégorie", () => {
    expect(searchDocuments(initialDocuments, "septembre energie", "Logement")).toHaveLength(1);
    expect(searchDocuments(initialDocuments, "energie", "Administratif")).toHaveLength(0);
    expect(searchDocuments(initialDocuments, "energie garantie")).toHaveLength(0);
  });

  it("retourne le catalogue pour une recherche vide sans modifier son ordre", () => {
    expect(searchDocuments(initialDocuments, "  ")).toEqual(initialDocuments);
    expect(searchDocuments(initialDocuments, "", "Vie quotidienne").map((document) => document.id)).toEqual(["library", "warranty"]);
  });

  it("traite la saisie comme du texte littéral et n’invente pas de résultat sémantique", () => {
    expect(searchDocuments(initialDocuments, ".*")).toEqual([]);
    expect(searchDocuments(initialDocuments, "payer mes dettes")).toEqual([]);
    expect(searchDocuments(initialDocuments, "<script>")).toEqual([]);
  });
});

describe("validation explicite et conservation de la source", () => {
  it("bloque l’utilisation de toute proposition en attente, quel que soit son score", () => {
    expect(mayUseProposal(pendingProposal)).toBe(false);
    expect(mayUseProposal({ ...pendingProposal, confidence: 1 })).toBe(false);
  });

  it("refuse de confirmer sans vérification explicite de la source", () => {
    expect(() => decideProposal(pendingProposal, "accept", false)).toThrow("Vérifiez la source");
    expect(pendingProposal.status).toBe("pending");
  });

  it("autorise une proposition seulement après la décision humaine et conserve sa provenance", () => {
    const original = structuredClone(pendingProposal);
    const accepted = decideProposal(pendingProposal, "accept", true);
    expect(mayUseProposal(accepted)).toBe(true);
    expect(accepted.source).toBe(pendingProposal.source);
    expect(accepted.value).toBe(pendingProposal.value);
    expect(accepted.confidence).toBe(pendingProposal.confidence);
    expect(pendingProposal).toEqual(original);
  });

  it("écarte la valeur sans effacer ni réécrire la source ambiguë", () => {
    const rejected = decideProposal(pendingProposal, "reject", false);
    expect(mayUseProposal(rejected)).toBe(false);
    expect(rejected.status).toBe("rejected");
    expect(rejected.source).toBe(pendingProposal.source);
    expect(rejected.source.excerpt).toContain("28 ou 29");
    expect(rejected.value).toBe(pendingProposal.value);
  });

  it("interdit de réécrire une décision déjà prise", () => {
    const rejected = decideProposal(pendingProposal, "reject", false);
    expect(() => decideProposal(rejected, "accept", true)).toThrow("déjà été traitée");
    const accepted = decideProposal(pendingProposal, "accept", true);
    expect(() => decideProposal(accepted, "reject", false)).toThrow("déjà été traitée");
  });
});

describe("originaux synthétiques", () => {
  it.each([...initialDocuments, extraDocument])("lie $id à son vrai original et à son empreinte exacte", (document) => {
    expect(document.source.originalPath).toMatch(/^\/demo\/[a-z-]+\.txt$/);
    const bytes = readFileSync(resolve("public", document.source.originalPath.slice(1)));
    const text = bytes.toString("utf8");
    expect(text).toContain("DOCUMENT ENTIÈREMENT SYNTHÉTIQUE");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(document.source.sha256);
    expect(text).toContain(document.source.excerpt);
    const [start, end] = document.source.lines.split("–").map(Number);
    expect(text.split(/\r?\n/).slice(start - 1, end).join("\n")).toBe(document.source.excerpt);
  });

  it("fournit des identifiants et des originaux distincts à chaque exemple", () => {
    const catalogue = [...initialDocuments, extraDocument];
    expect(new Set(catalogue.map((document) => document.id)).size).toBe(catalogue.length);
    expect(new Set(catalogue.map((document) => document.source.originalPath)).size).toBe(catalogue.length);
  });
});
