// The Lambda entry point the inbound Lambda invokes, through IAM, to fetch a sender's logo or mark
// certificate from the URL their BIMI record gives (ADR-0023). It needs no environment and no
// permissions, so the URL can reach nothing of Duva's.
import { internet } from "./internet.ts";
import { fetchForLogo, type LogoRequest } from "./sender-logos.ts";

export const handler = (request: LogoRequest) => fetchForLogo(internet, request);
