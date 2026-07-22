import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { validateContract } from "../src/contracts/validator";

const root = process.cwd();
const schemas = join(root, "src", "contracts", "schemas");
const fixtures = join(root, "src", "contracts", "fixtures");

for (const schemaFile of readdirSync(schemas).filter((name) => name.endsWith(".schema.json"))) {
  const stem = schemaFile.replace(".schema.json", "");
  const schema = JSON.parse(readFileSync(join(schemas, schemaFile), "utf8"));
  for (const kind of ["valid", "invalid"] as const) {
    const fixtureFile = `${stem}.${kind}.json`;
    const fixture = JSON.parse(readFileSync(join(fixtures, fixtureFile), "utf8"));
    const result = validateContract(schema, fixture);
    if ((kind === "valid") !== result.valid) throw new Error(`${basename(fixtureFile)} produjo un resultado inesperado: ${JSON.stringify(result.errors)}`);
  }
}
console.log("10 fixtures contractuales validados correctamente.");
