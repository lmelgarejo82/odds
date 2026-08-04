import { isAbsolute } from "node:path";
import { approveTeamAliases,proposeTeamAliases } from "../src/infrastructure/market-v2/daily/team-alias-workflow";
import { replayDailyOddsWithAliases } from "../src/infrastructure/market-v2/daily/replay-odds-with-aliases";

const [action,...argv]=process.argv.slice(2);const values=new Map<string,string>();
for(let index=0;index<argv.length;index+=2){const key=argv[index],value=argv[index+1];if(!key?.startsWith("--")||!value||value.startsWith("--")||values.has(key)){console.error("TEAM_ALIASES_FAILED ARGUMENT_INVALID");process.exit(1)}values.set(key,value)}
const databaseUrl=values.get("--database-url");if(!databaseUrl?.startsWith("file:/")){console.error("TEAM_ALIASES_FAILED DATABASE_URL_INVALID");process.exit(1)}
async function main(){
  if(action==="propose"){const runId=values.get("--run-id"),evidenceRoot=values.get("--evidence-root");if(values.size!==3||!runId||!evidenceRoot||!isAbsolute(evidenceRoot))throw new Error("PROPOSE_ARGUMENTS_INVALID");console.log(JSON.stringify(await proposeTeamAliases({databaseUrl:databaseUrl!,runId,evidenceRoot}),null,2))}
  else if(action==="approve"){const proposalFile=values.get("--proposal-file");if(values.size!==2||!proposalFile)throw new Error("APPROVE_ARGUMENTS_INVALID");console.log(JSON.stringify(await approveTeamAliases({databaseUrl:databaseUrl!,proposalFile}),null,2))}
  else if(action==="replay"){const runId=values.get("--run-id"),evidenceRoot=values.get("--evidence-root");if(values.size!==3||!runId||!evidenceRoot||!isAbsolute(evidenceRoot))throw new Error("REPLAY_ARGUMENTS_INVALID");console.log(JSON.stringify(await replayDailyOddsWithAliases({databaseUrl:databaseUrl!,runId,evidenceRoot}),null,2))}
  else throw new Error("ACTION_INVALID");
}
void main().catch(error=>{const code=error instanceof Error&&/^[A-Z0-9_]+$/u.test(error.message)?error.message:"TEAM_ALIASES_COMMAND_FAILED";console.error(`TEAM_ALIASES_FAILED ${code}`);process.exit(1)});
