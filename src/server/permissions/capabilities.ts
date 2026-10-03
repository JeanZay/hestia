export const CAPABILITIES = ["consulter", "déposer", "modifier", "supprimer", "partager", "exporter", "administrer"] as const;
export type Capability = typeof CAPABILITIES[number];
