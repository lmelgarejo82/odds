import Link from "next/link";

export const navigation = [
  ["Hoy", "/mejores-partidos"],
  ["Historial", "/historial"],
  ["Rendimiento", "/rendimiento"],
] as const;

export function Navigation() {
  return <nav className="main-nav" aria-label="Navegación principal">
    {navigation.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
  </nav>;
}
