import { PrismaClient } from "@prisma/client";
import { captureForebetOu25 } from "../src/application/capture-forebet";

async function main(){const argument=process.argv.slice(2).find(value=>value.startsWith("--date="));const date=argument?.slice(7)??process.env.npm_config_date;if(!date){console.error("Uso: npm run capture:forebet -- --date=2026-07-21");process.exitCode=2;return}const prisma=new PrismaClient();try{const report=await captureForebetOu25(date,{prisma});console.log(JSON.stringify({...report,observations:report.observations.slice(0,3)},null,2))}catch(error){console.error(`Captura Forebet fallida: ${error instanceof Error?error.message:"error desconocido"}`);process.exitCode=1}finally{await prisma.$disconnect()}}
void main();
