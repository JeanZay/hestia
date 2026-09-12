export type Connector = Readonly<{
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  status: "ready" | "error" | "unconfigured";
  permissions: readonly string[];
  lastSync: string | null;
  error: string | null;
}>;

export const initialConnectors: readonly Connector[] = [
  {
    id: "files",
    name: "Boîte de dépôt",
    description: "Le futur point d’entrée des fichiers du foyer.",
    enabled: true,
    status: "ready",
    permissions: ["Lire les fichiers déposés", "Créer une copie de travail"],
    lastSync: "11 sept. 2026 à 09:30 · exemple",
    error: null,
  },
  {
    id: "mobile",
    name: "Photo et scan mobile",
    description: "Photographier un document depuis un téléphone.",
    enabled: true,
    status: "error",
    permissions: ["Accès caméra sur demande", "Déposer la capture"],
    lastSync: null,
    error: "Exemple d’erreur : autorisation caméra refusée.",
  },
  {
    id: "email",
    name: "Pièces jointes e-mail",
    description: "Une connexion future, à autoriser séparément.",
    enabled: false,
    status: "unconfigured",
    permissions: ["Lire les pièces jointes autorisées", "Aucun envoi d’e-mail"],
    lastSync: null,
    error: null,
  },
];

export function canSimulateSync(connector: Connector, circuitOpen: boolean): boolean {
  return !circuitOpen && connector.enabled && connector.status === "ready";
}

export function setConnectorEnabled(connector: Connector, enabled: boolean): Connector {
  return { ...connector, enabled };
}

export function simulateSync(connector: Connector, circuitOpen: boolean): Connector {
  if (!canSimulateSync(connector, circuitOpen)) {
    throw new Error("La simulation est bloquée par l’état du connecteur ou le coupe-circuit.");
  }
  return { ...connector, lastSync: "À l’instant · simulation locale" };
}
