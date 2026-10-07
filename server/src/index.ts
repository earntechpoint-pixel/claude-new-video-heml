import { createApp } from './app';
import { loadConfig } from './config';
import { JobManager } from './jobs';

const cfg = loadConfig();
const manager = new JobManager(cfg);
await manager.init();

const server = createApp(cfg, manager).listen(cfg.port, () => {
  console.log(
    `Code2Video server on :${cfg.port} — workers=${cfg.workers}, concurrent jobs=${cfg.maxConcurrentJobs}, sandbox=${cfg.chromiumSandbox}`,
  );
});

const stop = () => {
  server.close();
  void manager.shutdown().finally(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
