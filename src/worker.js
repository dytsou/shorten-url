import { withFetchObservability } from "./lib/observability.js";
import { createWorkerHandler } from "./lib/worker-handler.js";

export const workerFetchHandler = createWorkerHandler();

export default withFetchObservability(workerFetchHandler);
