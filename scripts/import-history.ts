process.env.DATABASE_URL ??= "file:./dev.db";
export {};
const from = process.argv.find((value) => value.startsWith("--from="))?.slice(7) ?? process.env.npm_config_from ?? "2026-07-01"; const to = process.argv.find((value) => value.startsWith("--to="))?.slice(5) ?? process.env.npm_config_to ?? "2026-07-21";
async function main() { if (!from || !to) throw new Error("Use --from=2026-07-01 --to=2026-07-21"); const { importHistory } = await import("../src/application/import-history"); const { database } = await import("../src/infrastructure/database"); try { const result = await importHistory(from, to); console.log(JSON.stringify(result, null, 2)); } finally { await database.$disconnect(); } }
void main();
