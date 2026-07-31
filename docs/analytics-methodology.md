# Metodología analítica de Market V2

## Pregunta científica

La investigación futura deberá determinar, sin fuga temporal, si una señal prepartido adicional aporta calibración o valor incremental frente a probabilidades de mercado disponibles en el momento de decisión. Este documento define el método; no presenta resultados.

## Baseline y señal adicional

El baseline es la probabilidad de mercado derivada de cuotas identificables mediante un método no-vig versionado. Forebet se trata como señal adicional y nunca como verdad. Se estudiarán tanto concordancia como divergencia Forebet–mercado, incluyendo rangos de cuota y concentración por fecha, competición y bookmaker.

## Calibración, predicción y valor esperado

La calibración se evalúa con Brier, log loss y tablas por bins preregistrados. Accuracy siempre se acompaña de cobertura y tamaño de muestra. El valor esperado unitario se define como `p * cuota_decimal - 1`; un acierto aislado no demuestra valor ni rentabilidad.

Las métricas económicas flat-stake incluyen profit, ROI/yield, cuota media, hit rate, curva acumulada, drawdown y rachas. Deben reportarse por rango de cuota y periodo para detectar concentración temporal.

## Validación temporal

La validación principal es walk-forward, con train anterior a validation y gap explícito. Un holdout final permanece sin consultar hasta congelar reglas, features, rangos y métricas. Los splits aleatorios pueden usarse solo como diagnóstico secundario, nunca como evidencia principal.

## Riesgo estadístico

Comparar muchas señales, cortes o subgrupos aumenta el riesgo de multiple testing. Antes de una evaluación prospectiva deben preregistrarse hipótesis, política de decisiones, exclusions, bins, ventanas, métricas primarias y criterio de promoción. Cualquier cambio posterior exige una nueva versión y un nuevo holdout.

## Reproducibilidad y temporalidad

Todo análisis parte de Parquet inmutable con manifiesto, hashes y cutoff UTC. Las features no leen outcomes; la evaluación los incorpora después mediante una ruta separada. Cada resultado debe poder reconstruirse con snapshot, commit, `analytics/uv.lock`, configuración y semilla explícita.

Los datos sintéticos de este lote verifican contratos y código únicamente. No representan clubes, partidos, precios ni rendimiento reales y no autorizan ninguna afirmación económica.

## Consistencia de la fuente SQLite

El hash del archivo principal de una base viva no prueba que la lectura sea consistente: una transacción concurrente puede modificar páginas durante la extracción y un WAL puede contener estado confirmado que todavía no esté incorporado al archivo principal. Por eso la evidencia analítica parte de una copia cerrada, congelada y autorizada, sin WAL, SHM ni journal, leída dentro de una única transacción read-only. Se registran hash, tamaño, mtime y `data_version` antes y después.

El cutoff se interpreta por disponibilidad específica de tabla. Forebet y odds usan captura; las probabilidades, cálculo; las decisiones, decisión; y los outcomes, observación. Kickoff solo describe cuándo ocurre el partido y no cuándo se conoció una fila. Los fixtures futuros referenciados por evidencia prepartido elegible permanecen en el universo.

Los profiles forman una barrera estructural. `prematch` no carga el mapping de outcomes, no ejecuta consultas sobre `Outcome` ni publica metadata o Parquet de resultados. `evaluation` incorpora outcomes por una ruta separada y vuelve a aplicar el cutoff de observación.

Por cada tabla se registran filas fuente, elegibles, exportadas y excluidas por cutoff, invalidez, ausencia de referencia u otras causas. La suma debe cuadrar. El schema fingerprint deriva de nombres, columnas, tipos, nullability, PK, FK y SQL normalizado de las tablas visibles al profile; junto con mapping, commits, lock y hashes permite detectar deriva de schema y reconstruir la semántica de la exportación.

## Frontera prospectiva R0

La auditoría legacy concluyó `SCHEMA_MAPPING_UNSAFE`; sus datos no forman baseline, training set ni
evidencia prepartido de R0. El protocolo prospectivo comienza con contratos source-neutral y un
universo completo preregistrado. La agenda T-6h/T-60m/T-5m es nominal: siempre se usa la captura
real y nunca se imputa disponibilidad desde la hora objetivo.

Captura, decisión, closing y outcome son etapas separadas. Solo kickoff UTC `CONFIRMED` o `HIGH`
puede habilitar una decisión. Closing odds se usan únicamente para CLV y no sustituyen el precio
exacto seleccionado. Outcomes entran después del kickoff por la frontera de evaluación y las
correcciones crean versiones append-only.

Antes de consultar un holdout se congelan protocolo, snapshot, cutoff, mercados, reglas, rangos de
cuota, divergencia, tamaño mínimo, métricas, método no-vig, stake evaluativo, exclusiones, criterios
de promoción, fecha y commit. Un cambio posterior produce un nuevo preregistro; nunca se elige una
regla retrospectivamente por su resultado.
