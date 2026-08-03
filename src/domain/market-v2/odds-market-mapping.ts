import type { OddsApiEvent } from "@/infrastructure/market-v2/the-odds-api/client";
import type { DailyMarket,MarketQuote } from "./daily-analysis";

export type MappedOddsMarkets=Readonly<{quotes:readonly MarketQuote[];matchedMarkets:readonly DailyMarket[];unsupportedMarketKeys:readonly string[];doubleChanceOffered:boolean}>;
export function mapPriceableOdds(event:OddsApiEvent):MappedOddsMarkets{
  const quotes:MarketQuote[]=[];const matched=new Set<DailyMarket>(),unsupported=new Set<string>();let doubleChanceOffered=false;
  for(const bookmaker of event.bookmakers)for(const market of bookmaker.markets){
    if(market.key==="h2h_lay"){unsupported.add("h2h_lay");continue}
    if(market.key==="double_chance")doubleChanceOffered=true;
    for(const outcome of market.outcomes){let code:DailyMarket|null=null;
      if(market.key==="h2h")code=outcome.name===event.home_team?"HOME":outcome.name===event.away_team?"AWAY":/^draw$/iu.test(outcome.name)?"DRAW":null;
      if(market.key==="totals"&&outcome.point===2.5)code=/^over$/iu.test(outcome.name)?"OVER_25":/^under$/iu.test(outcome.name)?"UNDER_25":null;
      if(market.key==="double_chance")code=/home.*draw|1x/iu.test(outcome.name)?"1X":/draw.*away|x2/iu.test(outcome.name)?"X2":/home.*away|12/iu.test(outcome.name)?"12":null;
      if(code&&Number.isFinite(outcome.price)&&outcome.price>1){quotes.push({market:code,bookmaker:bookmaker.title,odds:outcome.price});matched.add(code)}
    }
  }
  return Object.freeze({quotes:Object.freeze(quotes),matchedMarkets:Object.freeze([...matched]),unsupportedMarketKeys:Object.freeze([...unsupported].sort()),doubleChanceOffered});
}
