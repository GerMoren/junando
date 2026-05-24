// Module augmentation: every snippet relies on req.correlationId being a string
// after the CorrelationIdInterceptor runs.
import "express";

declare module "express" {
  interface Request {
    correlationId?: string;
  }
}
