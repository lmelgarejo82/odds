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
