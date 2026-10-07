// The Lambda entry point the API invokes, through IAM, for each one-click unsubscribe. It needs no
// environment and no permissions.
import { internet } from "./internet.ts";
import { postOneClick } from "./unsubscriber.ts";

export const handler = ({ url }: { url: string }) => postOneClick(internet, url);
