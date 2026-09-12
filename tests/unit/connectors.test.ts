import { describe, expect, it } from "vitest";
import { canSimulateSync, initialConnectors, setConnectorEnabled, simulateSync } from "../../src/domain/connectors";

describe("connecteurs simulés", () => {
  const ready = initialConnectors[0];

  it("bloque tout connecteur lorsque le coupe-circuit global est activé", () => {
    for (const connector of initialConnectors) {
      expect(canSimulateSync(connector, true)).toBe(false);
      expect(() => simulateSync(connector, true)).toThrow("bloquée");
    }
  });

  it("la désactivation individuelle reste prioritaire après la levée du coupe-circuit", () => {
    const disabled = setConnectorEnabled(ready, false);
    expect(canSimulateSync(disabled, false)).toBe(false);
    expect(() => simulateSync(disabled, false)).toThrow("bloquée");
    expect(ready.enabled).toBe(true);
  });

  it("une erreur ou une configuration manquante bloque même un connecteur activé", () => {
    for (const connector of initialConnectors.slice(1)) {
      const enabled = setConnectorEnabled(connector, true);
      expect(canSimulateSync(enabled, false)).toBe(false);
      expect(() => simulateSync(enabled, false)).toThrow("bloquée");
    }
  });

  it("la simulation autorisée ne change que son état local et conserve les permissions", () => {
    const result = simulateSync(ready, false);
    expect(result.lastSync).toBe("À l’instant · simulation locale");
    expect(result.permissions).toBe(ready.permissions);
    expect(result.status).toBe(ready.status);
    expect(ready.lastSync).toContain("exemple");
  });

  it("réactiver le coupe-circuit bloque immédiatement une nouvelle simulation", () => {
    const synced = simulateSync(ready, false);
    expect(canSimulateSync(synced, true)).toBe(false);
    expect(() => simulateSync(synced, true)).toThrow("bloquée");
  });
});
