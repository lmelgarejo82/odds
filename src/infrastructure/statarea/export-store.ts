import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname,join,relative} from "node:path";
import schema from "@/contracts/schemas/statarea-daily-capture.schema.json";
import {validateContract} from "@/contracts/validator";
import {canonicalJson} from "@/domain/canonical-json";

export async function preserveStatareaExport(date:string,snapshotId:string,value:unknown):Promise<{relativePath:string;reused:boolean}>{const validation=validateContract(schema,value);if(!validation.valid)throw new Error(`AJV_EXPORT_INVALID:${JSON.stringify(validation.errors)}`);const absolute=join(process.cwd(),"var","exports","statarea",date,`${snapshotId}.json`);await mkdir(dirname(absolute),{recursive:true});const content=`${canonicalJson(value)}\n`;let reused=false;try{await writeFile(absolute,content,{flag:"wx",encoding:"utf8"})}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;reused=true;const existing=await readFile(absolute,"utf8");if(existing!==content)throw new Error("EXPORT_CONTENT_MISMATCH")}return{relativePath:relative(process.cwd(),absolute).replaceAll("\\","/"),reused}}
