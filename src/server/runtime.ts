import { createObjectStore } from "./storage";
import { Pool } from "pg";
import { createApplication } from "./application";
import { readServerConfig } from "./config";
import { createResendTransport } from "./identity/transport";
import { runMailBatch } from "./identity/worker";

let application: ReturnType<typeof createApplication> | undefined;
export function getApplication() {
  if (!application) {
    const config = readServerConfig();
    application = createApplication(new Pool({ connectionString: config.databaseUrl, max: 5,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 }), config, { store: createObjectStore() });
  }
  return application;
}

export function runApplicationMail() {
  const transport = createResendTransport(readServerConfig());
  return runMailBatch(() => getApplication().dispatchMail(transport));
}

