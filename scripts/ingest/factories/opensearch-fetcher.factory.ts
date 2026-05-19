import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import type {
  OpenSearchHttpFetcher,
  OpenSearchHttpResponse,
  SignedHttpRequest,
} from "../../../packages/core/src/index.js";

export interface CreateDefaultOpenSearchFetcherDeps {
  region: string;
  service?: string;
  fetchImpl?: typeof fetch;
}

// ─────────────────────────────────────────────────────────────────────────────
// createDefaultOpenSearchFetcher
// Returns an OpenSearchHttpFetcher that signs each request with AWS SigV4
// against the OpenSearch service (es). Credentials are resolved with the
// standard AWS credential provider chain (env, profile, IMDS, etc.).
// ─────────────────────────────────────────────────────────────────────────────
export function createDefaultOpenSearchFetcher(
  deps: CreateDefaultOpenSearchFetcherDeps,
): OpenSearchHttpFetcher {
  const signer = new SignatureV4({
    service: deps.service ?? "es",
    region: deps.region,
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  const doFetch = deps.fetchImpl ?? fetch;

  return async (request: SignedHttpRequest): Promise<OpenSearchHttpResponse> => {
    const url = new URL(request.url);
    const port = url.port ? Number(url.port) : undefined;

    const httpRequest = new HttpRequest({
      method: request.method,
      protocol: url.protocol,
      hostname: url.hostname,
      ...(port === undefined ? {} : { port }),
      path: url.pathname + url.search,
      headers: {
        ...request.headers,
        host: url.host,
      },
      body: request.body,
    });

    const signed = await signer.sign(httpRequest);

    const response = await doFetch(request.url, {
      method: signed.method,
      headers: signed.headers as Record<string, string>,
      body: signed.body as string,
    });

    const body = await response.text();
    return { status: response.status, body };
  };
}
