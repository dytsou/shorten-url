import { withFetchObservability } from "./lib/observability.js";
import config from "../config/config.js";
import { createWorkerHandler } from "./lib/worker-handler.js";

export const workerFetchHandler = createWorkerHandler({ configOverrides: config });

export default withFetchObservability(workerFetchHandler);
