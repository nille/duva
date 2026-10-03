import { randomUUID } from "node:crypto";
import type {
  APIGatewayEventRequestContextV2,
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerWithContextResult,
} from "aws-lambda";
import { operations } from "@duva/openapi";

export type ApiHandler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;
export type AuthorizerHandler = (event: APIGatewayRequestAuthorizerEventV2) => Promise<APIGatewaySimpleAuthorizerWithContextResult<object>>;

/**
 * Stands in for the API Gateway HTTP API. It routes a request to the API the way the deployed
 * routes do, which the CDK app creates from the same operations. Routes that need sign-in run the
 * authorizer first, which has no identity sources: it runs on every call and answers 401 by
 * failing with "Unauthorized".
 */
export function gateway(handler: ApiHandler, authorizer: AuthorizerHandler): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const operation = operations.find(({ routeKey }) => routeKey === `${request.method} ${url.pathname}`);
    if (operation === undefined) return Response.json({ message: "Not Found" }, { status: 404 });

    const { routeKey } = operation;
    const body = await request.text();
    const headers = Object.fromEntries(request.headers);
    const queryStringParameters = url.search === "" ? undefined : Object.fromEntries(url.searchParams);
    const requestContext = context(request, url, routeKey);

    let authorizerContext: object | undefined;
    if (operation.signIn) {
      try {
        const result = await authorizer({
          version: "2.0",
          type: "REQUEST",
          routeArn: `arn:aws:execute-api:eu-north-1:000000000000:harness/$default/${request.method}${url.pathname}`,
          identitySource: [],
          routeKey,
          rawPath: url.pathname,
          rawQueryString: url.search.slice(1),
          cookies: [],
          headers,
          queryStringParameters,
          requestContext,
        });
        if (!result.isAuthorized) return Response.json({ message: "Forbidden" }, { status: 403 });
        authorizerContext = result.context;
      } catch (error) {
        if (error instanceof Error && error.message === "Unauthorized") return Response.json({ message: "Unauthorized" }, { status: 401 });
        return Response.json({ message: "Internal Server Error" }, { status: 500 });
      }
    }

    const result = await handler({
      version: "2.0",
      routeKey,
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      headers,
      queryStringParameters,
      // What the authorizer resolved reaches the API in the request context, as in API Gateway.
      requestContext: { ...requestContext, authorizer: authorizerContext && { lambda: authorizerContext } } as APIGatewayEventRequestContextV2,
      body: body === "" ? undefined : body,
      isBase64Encoded: false,
    });

    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(result.headers ?? {})) responseHeaders.set(name, String(value));
    return new Response(result.body ?? null, { status: result.statusCode ?? 200, headers: responseHeaders });
  };
}

function context(request: Request, url: URL, routeKey: string): APIGatewayEventRequestContextV2 {
  return {
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
  };
}
