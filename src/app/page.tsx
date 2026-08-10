import { connection } from "next/server";
import { DailyRankingStatus } from "@/components/daily-ranking-status";

export default async function Home() {
  await connection();
  return <DailyRankingStatus />;
}
