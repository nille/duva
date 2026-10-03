import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { operations } from "@duva/openapi";

export type ApiHandler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;

/**
 * Stands in for the API Gateway HTTP API. It routes a request to the API the way the deployed
 * routes do, which the CDK app creates from the same operations.
 */
export function gateway(handler: ApiHandler): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const operation = operations.find(({ routeKey }) => routeKey === `${request.method} ${url.pathname}`);
    if (operation === undefined) return Response.json({ message: "Not Found" }, { status: 404 });

    const { routeKey } = operation;
    const body = await request.text();
    const result = await handler({
      version: "2.0",
      routeKey,
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      headers: Object.fromEntries(request.headers),
      queryStringParameters: url.search === "" ? undefined : Object.fromEntries(url.searchParams),
      requestContext: {
        accountId: "000000000000",
        apiId: "harness",
        domainName: url.host,
        domainPrefix: url.hostname.split(".")[0] ?? url.hostname,
        http: {
          method: request.method,
          path: url.pathname,
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: request.headers.get("user-agent") ?? "",
        },
        requestId: randomUUID(),
        routeKey,
        stage: "$default",
        time: new Date().toISOString(),
        timeEpoch: Date.now(),
      },
      body: body === "" ? undefined : body,
      isBase64Encoded: false,
    });

    const headers = new Headers();
    for (const [name, value] of Object.entries(result.headers ?? {})) headers.set(name, String(value));
    return new Response(result.body ?? null, { status: result.statusCode ?? 200, headers });
  };
}
