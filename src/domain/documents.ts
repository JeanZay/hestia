export type DocumentCategory = "Logement" | "Vie quotidienne" | "Administratif";

export type SourceReference = Readonly<{
  originalPath: string;
  fileName: string;
  sha256: string;
  excerpt: string;
  lines: string;
}>;

export type FactProposal = Readonly<{
  id: string;
  label: string;
  value: string;
  confidence: number;
  status: "pending" | "accepted" | "rejected";
  source: SourceReference;
}>;

export type FamilyDocument = Readonly<{
  id: string;
  title: string;
  category: DocumentCategory;
  dateLabel: string;
  summary: string;
  tags: readonly string[];
  icon: "home" | "book" | "paper" | "cup" | "leaf";
  source: SourceReference;
  facts: readonly Readonly<{ label: string; value: string }>[];
  proposal?: FactProposal;
}>;

export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").trim();
}

/** Every search term must occur in the local catalogue. No semantic search or network. */
export function searchDocuments(
  documents: readonly FamilyDocument[],
  query: string,
  category: DocumentCategory | "Tous" = "Tous",
): FamilyDocument[] {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  return documents.filter((document) => {
    if (category !== "Tous" && document.category !== category) return false;
    const haystack = normalizeSearch(
      [document.title, document.category, document.summary, ...document.tags].join(" "),
    );
    return terms.every((term) => haystack.includes(term));
  });
}

/** Confidence never authorizes a value for use without the explicit review step. */
export function mayUseProposal(proposal: FactProposal): boolean {
  return proposal.status === "accepted";
}

export function decideProposal(
  proposal: FactProposal,
  decision: "accept" | "reject",
  sourceReviewed: boolean,
): FactProposal {
  if (proposal.status !== "pending") throw new Error("Cette proposition a déjà été traitée.");
  if (decision === "accept" && !sourceReviewed) {
    throw new Error("Vérifiez la source avant de confirmer cette valeur.");
  }
  return { ...proposal, status: decision === "accept" ? "accepted" : "rejected" };
}
