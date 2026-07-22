# Captura controlada Forebet — 2026-07-21

La única URL permitida es `https://www.forebet.com/es/predicciones-de-futbol/predicciones-bajo-mas-2-5-goles/2026-07-21`. El cliente usa HTTPS, redirección manual, timeout de 20 segundos, cuerpo máximo de 5 MB y no envía cookies. El HTML no se ejecuta ni se renderiza.

## Semántica demostrada

La cabecera real ordena las columnas como `Menos/Más 2.5`, `Pred.`, `Marcador Pred.`, `Promedio de goles` y `Cuota`. Dentro de cada `.rcnt`, `.homeTeam` y `.awayTeam` identifican los equipos; `.date_bah`, la fecha/hora; los dos hijos de `.fprc`, Under y Over en ese orden; `.forepr` contiene la etiqueta explícita `Menos` o `Más`; el hijo directo `.ex_sc.tabonly`, el marcador previsto; `.avg_sc.tabonly`, el promedio; y `.prmod > .lscrsp`, la cuota publicada. País y competición proceden de los argumentos rotulados del control de competición `getstag`. La categoría corta procede de `.shortTag`.

Las áreas `.lscr_td`, `.l_scr`, `.ht_scr` y `.aftscr` corresponden a resultados y se ignoran explícitamente.

## Evidencia real

- HTTP: 200; `text/html; charset=utf-8`.
- Captura inicial UTC: 2026-07-22T13:33:26.917Z.
- URL final: igual a la solicitada, sin redirección.
- Tamaño: 228609 bytes.
- SHA-256: `41539d0e0e1ec9a5dadd7a144a79e5d14a31878a5de0fedffdf54c20c9946c6b`.
- Ruta runtime: `var/evidence/forebet/2026-07-21/41539d0e0e1ec9a5dadd7a144a79e5d14a31878a5de0fedffdf54c20c9946c6b.html`.
- Parser: `forebet-ou25-es/1.0.0`.
- Filas: 44 encontradas, 42 válidas, 2 rechazadas por fecha distinta, 0 duplicadas y 0 warnings.
- Segunda captura UTC: 2026-07-22T13:33:46.886Z; mismo hash y snapshot reutilizado.
