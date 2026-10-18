import { createObjectStore } from "./storage";
import { Pool } from "pg";
import { createApplication } from "./application";
import { readServerConfig, readInboxDeployment } from "./config";
import { createResendTransport } from "./identity/transport";
import { runMailBatch } from "./identity/worker";
import { readClassificationDeployment } from "./classification/deployment";
import { readTranscriptionDeployment } from "./transcription/deployment";
import { readSummaryDeployment } from './summary/deployment';
import { createInboxAcknowledgementTransport } from './inbox/acknowledgement';
import { readOutgoingDeployment } from './outgoing/deployment';

let application: ReturnType<typeof createApplication> | undefined;
export function getApplication() {
  if (!application) {
    const config = readServerConfig();
    application = createApplication(new Pool({ connectionString: config.databaseUrl, max: 5,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 }), config, { store: createObjectStore(),
      classification: readClassificationDeployment(config.environment), transcription: readTranscriptionDeployment(config.environment),
      summary:readSummaryDeployment(config.environment),
      outgoing:readOutgoingDeployment(config),
      inbox:{...readInboxDeployment(config.environment),acknowledge:createInboxAcknowledgementTransport(config)} });
  }
  return application;
}

export function runApplicationMail() {
  const transport = createResendTransport(readServerConfig());
  return runMailBatch(() => getApplication().dispatchMail(transport));
}

