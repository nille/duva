// An MCP client, the MCP SDK's own, as Claude Code is one: it finds how to sign in from the MCP
// endpoint's 401, registers itself, signs the human in through managed login with PKCE, then
// connects. The human enters their address on managed login's page, as the stand-in takes it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

export interface McpClientOptions {
  /** The name the client registers with. */
  clientName?: string;
  /** Where managed login sends the human back to, as Claude Code listens on the machine itself. */
  redirectUri?: string;
  /** How the client authenticates at the token endpoint: with no secret, as Claude Code, or with one it registered for. */
  tokenEndpointAuthMethod?: "none" | "client_secret_basic" | "client_secret_post";
}

/** An MCP client connected to the endpoint, with what it registered and the tokens it holds. */
export interface ConnectedMcpClient {
  client: Client;
  registered: OAuthClientInformationMixed;
  tokens: OAuthTokens;
}

export async function connectMcpClient(
  url: string,
  email: string,
  fetchFrom: (request: Request) => Promise<Response>,
  { clientName = "Claude Code", redirectUri = "http://localhost:33418/callback", tokenEndpointAuthMethod = "none" }: McpClientOptions = {},
): Promise<ConnectedMcpClient> {
  const fetch = (input: string | URL, init?: RequestInit) => fetchFrom(new Request(String(input), init));
  let registered: OAuthClientInformationMixed | undefined;
  let tokens: OAuthTokens | undefined;
  let verifier = "";
  let code: string | undefined;
  const provider: OAuthClientProvider = {
    redirectUrl: redirectUri,
    clientMetadata: { client_name: clientName, redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: tokenEndpointAuthMethod },
    clientInformation: () => registered,
    saveClientInformation: (information) => void (registered = information),
    tokens: () => tokens,
    saveTokens: (saved) => void (tokens = saved),
    saveCodeVerifier: (saved) => void (verifier = saved),
    codeVerifier: () => verifier,
    // The human's browser opens Duva's authorize endpoint, where they allow the app, then signs in
    // on managed login, and is sent back by way of Duva's callback to the client, with a code.
    async redirectToAuthorization(authorizationUrl) {
      const followed = async (answer: Response) => {
        const to = answer.headers.get("location");
        if (to === null) throw new Error(`The sign-in of ${email} stopped at ${answer.status}: ${await answer.text()}`);
        return to;
      };
      const asking = await fetch(authorizationUrl);
      const consent = /name="consent" value="([^"]+)"/.exec(await asking.text())?.[1];
      if (consent === undefined) throw new Error(`Duva didn't ask ${email} to allow the app (${asking.status}).`);
      const login = await followed(await fetch(authorizationUrl, { method: "POST", body: new URLSearchParams({ consent, decision: "allow" }) }));
      const callback = await followed(await fetch(login, { method: "POST", body: new URLSearchParams({ email }), headers: { "content-type": "application/x-www-form-urlencoded" } }));
      code = new URL(await followed(await fetch(callback))).searchParams.get("code") ?? undefined;
    },
  };
  const transport = () => new StreamableHTTPClientTransport(new URL(url), { authProvider: provider, fetch });
  const client = new Client({ name: clientName, version: "1.0.0" });
  try {
    await client.connect(transport());
  } catch (error) {
    if (!(error instanceof UnauthorizedError) || code === undefined) throw error;
    const signedIn = transport();
    await signedIn.finishAuth(code);
    await client.connect(signedIn);
  }
  return { client, registered: registered!, tokens: tokens! };
}
