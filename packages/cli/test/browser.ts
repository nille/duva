// Acts as the browser duva login opens, for the CLI tests.
//
//   node browser.ts --sign-in-as ada@example.com <url>   signs in on the managed login page at <url>
//   node browser.ts --open <other-url> <url>             opens <other-url> instead
//
// Signing in posts the address to the page, which the harness's managed login answers with a
// redirect to the loopback address, and follows it, as a browser would.
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "sign-in-as": { type: "string" }, open: { type: "string" } },
});
const [url] = positionals;
if (url === undefined) throw new Error("Give the URL to open.");

if (values.open !== undefined) {
  await fetch(values.open);
} else {
  await fetch(url, { method: "POST", body: new URLSearchParams({ email: values["sign-in-as"] ?? "" }) });
}
