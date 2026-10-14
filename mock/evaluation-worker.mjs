import { runtimePool as pool, assertSchemaCurrent } from './postgres-store.mjs';
if (process.env.NODE_ENV === 'production' && !process.env.APP_DATABASE_URL) throw new Error('生产环境必须配置独立的 APP_DATABASE_URL 运行账号');
import { recoverExperimentJobs, runExperimentJobs } from './experiment-runner.mjs';
import { processDueExperimentSchedules } from './experiment-schedules.mjs';
import { processDueEvaluationSchedules } from './evaluation-schedules.mjs';
import { flushModelCallAudits } from './model-call-audit.mjs';
import { processDueModelRetirements } from './model-retirement.mjs';

let stopping=false;
process.on('SIGTERM',()=>{stopping=true;void flushModelCallAudits().finally(()=>pool.end().finally(()=>process.exit(0)));});
process.on('SIGINT',()=>{stopping=true;void flushModelCallAudits().finally(()=>pool.end().finally(()=>process.exit(0)));});
try {
  await assertSchemaCurrent(pool);
  await recoverExperimentJobs(pool);
  console.log('[evaluation-worker] PostgreSQL job runner ready');
} catch(error) {
  console.error('[evaluation-worker] startup failed:',error);
  await pool.end();process.exit(1);
}

async function scheduleLoop() {
  if(stopping)return;
  try {await processDueModelRetirements(pool);await processDueExperimentSchedules(pool);await processDueEvaluationSchedules(pool);}
  catch(error){console.error('[evaluation-worker] schedule failed:',error);}
  finally {if(!stopping)setTimeout(scheduleLoop,1000);}
}
async function runLoop() {
  if(stopping)return;
  try {await runExperimentJobs(pool);}
  catch(error){console.error('[evaluation-worker] run failed:',error);}
  finally {if(!stopping)setTimeout(runLoop,1500);}
}
void scheduleLoop();
void runLoop();
