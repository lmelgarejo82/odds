process.env.DATABASE_URL ??= "file:./dev.db";

async function main() {
  const [{ importHistory }, { HISTORY_FROM, HISTORY_TO }, { database }] = await Promise.all([
    import("../src/application/import-history"),
    import("../src/domain/history/constants"),
    import("../src/infrastructure/database"),
  ]);

  try {
    const result = await importHistory(HISTORY_FROM, HISTORY_TO, { throughDate: HISTORY_FROM });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await database.$disconnect();
  }
}

void main();
