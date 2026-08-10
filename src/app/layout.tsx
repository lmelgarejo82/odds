import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "@/components/navigation";
import "./globals.css";
import "./history.css";
import "./daily.css";

export const metadata: Metadata = { title:"Odds Intelligence", description:"Análisis diario de partidos con señales explicables" };
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="es"><body><header className="app-header"><Link className="brand" href="/mejores-partidos" aria-label="Odds Intelligence, inicio"><span>OI</span><div>Odds Intelligence<small>Análisis diario explicable</small></div></Link><Navigation/></header><main>{children}</main><footer>Información para revisión personal. No ejecuta apuestas ni garantiza resultados.</footer></body></html>}
