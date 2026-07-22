import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateContract } from "@/contracts/validator";

const schemaDirectory=join(process.cwd(),"src","contracts","schemas");
const fixtureDirectory=join(process.cwd(),"src","contracts","fixtures");
const schemas=readdirSync(schemaDirectory).filter(name=>name.endsWith(".schema.json"));
const json=(path:string)=>JSON.parse(readFileSync(path,"utf8"));

describe("contratos JSON",()=>{
  for(const schemaFile of schemas){
    const stem=schemaFile.replace(".schema.json",""); const schema=json(join(schemaDirectory,schemaFile));
    it(`${stem}: acepta fixture válido`,()=>expect(validateContract(schema,json(join(fixtureDirectory,`${stem}.valid.json`))).valid).toBe(true));
    it(`${stem}: rechaza fixture inválido`,()=>expect(validateContract(schema,json(join(fixtureDirectory,`${stem}.invalid.json`))).valid).toBe(false));
    it(`${stem}: rechaza additionalProperties`,()=>{const fixture=json(join(fixtureDirectory,`${stem}.valid.json`));expect(validateContract(schema,{...fixture,noPermitido:true}).valid).toBe(false)});
  }
});
