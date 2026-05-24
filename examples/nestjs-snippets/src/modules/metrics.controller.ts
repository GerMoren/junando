/**
 * MetricsController exposes /metrics for Prometheus to scrape.
 *
 * The Registry is a singleton; collectDefaultMetrics adds Node.js process
 * metrics (memory, event loop lag, etc.). Add your own counters/histograms in
 * a dedicated service and pass the same registry.
 *
 * Wire it up in AppModule:
 *
 *   @Module({ controllers: [MetricsController] })
 *   export class AppModule {}
 */
import { Controller, Get, Header } from "@nestjs/common";
import { Registry, collectDefaultMetrics, Counter } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpErrors = new Counter({
  name: "http_errors_total",
  help: "Total HTTP 5xx responses returned by this service",
  labelNames: ["route"],
  registers: [registry],
});

@Controller("metrics")
export class MetricsController {
  @Get()
  @Header("Content-Type", registry.contentType)
  async getMetrics(): Promise<string> {
    return registry.metrics();
  }
}
