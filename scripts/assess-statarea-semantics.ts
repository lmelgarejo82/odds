import { PrismaClient } from "@prisma/client";
import { assessStatareaSemantics } from "../src/application/assess-statarea-semantics";
import { canonicalJson } from "../src/domain/canonical-json";
import { SEMANTIC_LEGEND_SHA256, SEMANTIC_MANIFEST_HASH } from "../src/domain/statarea-semantics/constants";
import { SEMANTIC_REGISTRY_HASH } from "../src/domain/statarea-semantics/registry";

const prisma = new PrismaClient();

function parseArguments(argv: string[]) {
  if (argv.length === 0 && process.env.npm_config_dataset) {
    const forbiddenNpmFlags = ["force", "skip_validation", "include_results", "url", "html_path", "semantic_direction", "invert_over_under", "ranking"];
    const forbidden = forbiddenNpmFlags.find((flag) => process.env[`npm_config_${flag}`]);
    if (forbidden) throw new Error(`SEMANTIC_ARGUMENT_NOT_ALLOWED:${forbidden.replaceAll("_", "-")}`);
    const dataset = process.env.npm_config_dataset;
    const registryVersion = process.env.npm_config_registry;
    if (!dataset || !registryVersion) throw new Error("SEMANTIC_REQUIRED_ARGUMENT_MISSING");
    return { dataset, registryVersion };
  }
  if (argv.length !== 2) throw new Error("EXPECTED_EXACTLY_DATASET_AND_REGISTRY_ARGUMENTS");
  const values = Object.fromEntries(argv.map((argument) => {
    const match = argument.match(/^--(dataset|registry)=([^=]+)$/);
    if (!match) throw new Error(`SEMANTIC_ARGUMENT_NOT_ALLOWED:${argument}`);
    return [match[1], match[2]];
  }));
  if (!values.dataset || !values.registry) throw new Error("SEMANTIC_REQUIRED_ARGUMENT_MISSING");
  return { dataset: values.dataset, registryVersion: values.registry };
}

async function main() {
  let request: ReturnType<typeof parseArguments> | null = null;
  try {
    request = parseArguments(process.argv.slice(2));
    Object.defineProperty(globalThis, "fetch", { configurable: false, value: () => { throw new Error("SEMANTIC_ASSESSMENT_NETWORK_FORBIDDEN"); } });
    const result = await assessStatareaSemantics(prisma, request);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await prisma.semanticAuditEvent.create({ data: {
      eventType: "ASSESSMENT_ERROR",
      contextJson: canonicalJson({
        registryVersion: request?.registryVersion ?? null,
        registryHash: SEMANTIC_REGISTRY_HASH,
        legendSha256: SEMANTIC_LEGEND_SHA256,
        dataset: request?.dataset ?? null,
        manifestHash: SEMANTIC_MANIFEST_HASH,
        errorCode: error instanceof Error ? error.message.slice(0, 240) : "UNKNOWN_ASSESSMENT_ERROR",
      }),
    } }).catch(() => undefined);
    throw error;
  }
}

void main().finally(() => prisma.$disconnect());
