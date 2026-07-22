import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { canonicalJson } from "@/domain/canonical-json";
import { statareaLegacyCaptureContractSchema } from "@/contracts/statarea-legacy-capture";

export async function preserveLegacyStatareaExport(date:string,snapshotId:string,value:unknown){statareaLegacyCaptureContractSchema.parse(value);const absolute=join(process.cwd(),"var","exports","statarea-legacy",date,`${snapshotId}.json`);await mkdir(dirname(absolute),{recursive:true});const content=`${canonicalJson(value)}\n`;let reused=false;try{await writeFile(absolute,content,{flag:"wx"})}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;reused=true;if(await readFile(absolute,"utf8")!==content)throw new Error("LEGACY_EXPORT_CONTENT_MISMATCH")}return{relativePath:relative(process.cwd(),absolute).replaceAll("\\","/"),reused}}
