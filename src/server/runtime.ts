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
import { createAgendaTransport } from './agenda/transport';
import { runAgendaMailBatch } from './agenda/worker';

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

export async function runApplicationMail() {
  const config=readServerConfig(),transport=createResendTransport(config);
  // Identity keeps priority; both loops fit the existing 60-second route/55-second relay.
  const until=Date.now()+45000;
  const identity=await runMailBatch(()=>getApplication().dispatchMail(transport));
  let agenda={sent:0,failed:0,cancelled:0,deferred:0,available:true};
  try{if(config.environment!=='local'&&process.env.HESTIA_AGENDA_MAIL_ENABLED==='true'){
    const agendaTransport=createAgendaTransport(config);
    agenda=await runAgendaMailBatch(()=>getApplication().dispatchAgendaMail(agendaTransport),until);
  }
  }catch{
    // A failure in the independent Agenda outbox must never prevent identity delivery.
    agenda={sent:0,failed:1,cancelled:0,deferred:0,available:false};
  }
  return {sent:identity.sent+agenda.sent,failed:identity.failed+agenda.failed,cancelled:identity.cancelled+agenda.cancelled,
    available:identity.available&&agenda.available,deferred:agenda.deferred};
}

