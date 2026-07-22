import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "@/components/navigation";
import "./globals.css";
import "./history.css";

export const metadata: Metadata = { title:"Laboratorio Consenso 2.5", description:"Análisis experimental Forebet + Statarea" };
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="es"><body><header><Link className="brand" href="/" aria-label="Laboratorio Consenso 2.5, inicio"><span>2.5</span><div>Laboratorio Consenso<small>Forebet × Statarea</small></div></Link><Navigation/></header><main>{children}</main><footer>Prioridad estimada para apoyo de decisiones. No representa certeza, garantía ni apuestas ejecutadas.</footer></body></html>}
