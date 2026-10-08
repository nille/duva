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
    const route = operations
      .map((operation) => ({ operation, pathParameters: match(operation, request.method, url.pathname) }))
      .find(({ pathParameters }) => pathParameters !== undefined);
    if (route === undefined) return Response.json({ message: "Not Found" }, { status: 404 });
    const { operation, pathParameters } = route;

    const { routeKey } = operation;
    const body = await request.text();
    const headers = Object.fromEntries(request.headers);
    // API Gateway joins a parameter given more than once with commas, as kinds=a&kinds=b reaches the API as "a,b".
    const queryStringParameters = url.search === "" ? undefined : Object.fromEntries([...new Set(url.searchParams.keys())].map((name) => [name, url.searchParams.getAll(name).join(",")]));
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
      pathParameters: Object.keys(pathParameters!).length > 0 ? pathParameters : undefined,
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

/** The path parameters, if the request is for the operation's route, where each {name} matches one path segment. */
function match(operation: (typeof operations)[number], method: string, path: string): Record<string, string> | undefined {
  const route = operation.path.split("/");
  const segments = path.split("/");
  if (operation.method.toUpperCase() !== method || route.length !== segments.length) return undefined;
  const parameters: Record<string, string> = {};
  for (const [index, part] of route.entries()) {
    const segment = segments[index]!;
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    if (name !== undefined && segment !== "") parameters[name] = decodeURIComponent(segment);
    else if (part !== segment) return undefined;
  }
  return parameters;
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
