import type { FamilyDocument, SourceReference } from "./documents";

const mediaSource: SourceReference = {
  originalPath: "/demo/mediatheque.txt",
  fileName: "mediatheque.txt",
  sha256: "d45dc51ea2acc13d791c2d717e34382d563d3468c4a5126084783c08ce71e898",
  excerpt: "Date inscrite sur la note : 28 ou 29 septembre 2026 (écriture ambiguë)\nProposition de lecture à vérifier : 29 septembre 2026",
  lines: "8–9",
};

export const initialDocuments: readonly FamilyDocument[] = [
  {
    id: "energy",
    title: "Facture d’énergie · septembre",
    category: "Logement",
    dateLabel: "12 sept. 2026",
    summary: "La facture d’exemple et ses informations essentielles, réunies au même endroit.",
    tags: ["électricité", "énergie", "facture", "septembre"],
    icon: "home",
    source: {
      originalPath: "/demo/energie-septembre.txt",
      fileName: "energie-septembre.txt",
      sha256: "b33e87f6d255d16250da735e32a691dda58e7c2575304eb666c39e4e1256ac27",
      excerpt: "Période : septembre 2026\nMontant : 92,40 EUR\nÉchéance : 30 septembre 2026",
      lines: "7–9",
    },
    facts: [
      { label: "Montant d’exemple", value: "92,40 €" },
      { label: "Échéance d’exemple", value: "30 septembre 2026" },
    ],
  },
  {
    id: "library",
    title: "Inscription à la médiathèque",
    category: "Vie quotidienne",
    dateLabel: "11 sept. 2026",
    summary: "Une date est ambiguë dans la source. Votre décision est nécessaire avant de l’utiliser.",
    tags: ["bibliothèque", "médiathèque", "inscription", "renouvellement"],
    icon: "book",
    source: mediaSource,
    facts: [{ label: "Objet", value: "Renouvellement de l’inscription" }],
    proposal: {
      id: "library-date",
      label: "Date de renouvellement",
      value: "29 septembre 2026",
      confidence: 0.62,
      status: "pending",
      source: mediaSource,
    },
  },
  {
    id: "certificate",
    title: "Attestation du foyer",
    category: "Administratif",
    dateLabel: "8 sept. 2026",
    summary: "Un exemple de pièce administrative, avec sa provenance et son original accessibles.",
    tags: ["attestation", "administratif", "foyer"],
    icon: "paper",
    source: {
      originalPath: "/demo/attestation.txt",
      fileName: "attestation.txt",
      sha256: "73a43a5e33624127b45f9c6fffe0bdf02fe7ca1396ca3e796e88080820270540",
      excerpt: "Date d’émission : 8 septembre 2026\nObjet : exemple de pièce administrative",
      lines: "7–8",
    },
    facts: [{ label: "Émission d’exemple", value: "8 septembre 2026" }],
  },
  {
    id: "warranty",
    title: "Garantie de la bouilloire",
    category: "Vie quotidienne",
    dateLabel: "3 sept. 2026",
    summary: "Retrouver les informations d’un équipement sans chercher dans un dossier papier.",
    tags: ["garantie", "bouilloire", "appareil", "achat"],
    icon: "cup",
    source: {
      originalPath: "/demo/garantie.txt",
      fileName: "garantie.txt",
      sha256: "32be28c90dae8e0c4a5f8dabcb904c31781a42f52fb9700af8b77fd642190501",
      excerpt: "Produit fictif : bouilloire Exemple 01\nDate d’achat : 3 septembre 2026\nDurée de garantie d’exemple : 24 mois",
      lines: "6–8",
    },
    facts: [
      { label: "Achat d’exemple", value: "3 septembre 2026" },
      { label: "Garantie d’exemple", value: "24 mois" },
    ],
  },
];

export const extraDocument: FamilyDocument = {
  id: "garden",
  title: "Atelier jardin en famille",
  category: "Vie quotidienne",
  dateLabel: "12 sept. 2026",
  summary: "Cet exemple vient d’être ajouté au catalogue de cette session. Aucun fichier n’a été envoyé.",
  tags: ["atelier", "jardin", "famille", "activité"],
  icon: "leaf",
  source: {
    originalPath: "/demo/atelier-jardin.txt",
    fileName: "atelier-jardin.txt",
    sha256: "07a65744940a0d065e5f8863c032476fb614e8d5a03799f7c63c2c818e05952a",
    excerpt: "Activité fictive : atelier jardin en famille\nDate : 19 septembre 2026\nHoraire : 10:00",
    lines: "6–8",
  },
  facts: [
    { label: "Date d’exemple", value: "19 septembre 2026" },
    { label: "Horaire d’exemple", value: "10:00" },
  ],
};
