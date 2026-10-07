// Makes the mark certificates the tests verify logos with, as `node make.ts` in this directory:
// root.pem, a Mark Verifying Authority of the tests' own; vmc.pem, a VMC it issued for
// example.org carrying logo.svg, valid for ten years from when it was made; and stranger.pem, the
// same VMC from an authority no one trusts. Each chain is the VMC, then its root, as brands publish them.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const work = mkdtempSync(join(tmpdir(), "duva-marks-"));
const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: work });
const at = (name: string) => join(work, name);

// DER: a tag, its length and its content.
const der = (tag: number, ...content: Buffer[]) => {
  const body = Buffer.concat(content);
  const length = body.length < 128 ? Buffer.from([body.length]) : body.length < 256 ? Buffer.from([0x81, body.length]) : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const sha256 = Buffer.from("0609608648016503040201", "hex");
const logo = readFileSync(new URL("logo.svg", import.meta.url));
const hash = execFileSync("openssl", ["dgst", "-sha256", "-binary"], { input: logo });
// RFC 3709's LogotypeExtn with the logo as the subject's: [2] { [0] { images { image { details } } } }.
const details = der(0x30, der(0x16, Buffer.from("image/svg+xml")), der(0x30, der(0x30, der(0x30, sha256), der(0x04, hash))), der(0x30, der(0x16, Buffer.from(`data:image/svg+xml;base64,${gzipSync(logo).toString("base64")}`))));
const logotype = der(0x30, der(0xa2, der(0xa0, der(0x30, der(0x30, details)))));

const authority = (name: string) => {
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.pem`, "-days", "36500", "-subj", `/O=Duva tests/CN=${name} Verified Mark Root CA`, "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
};
const mark = (issuer: string, out: string) => {
  writeFileSync(at("mark.cnf"), ["[mark]", "basicConstraints=critical,CA:FALSE", "keyUsage=critical,digitalSignature", "extendedKeyUsage=1.3.6.1.5.5.7.3.31", "subjectAltName=DNS:example.org", `1.3.6.1.5.5.7.1.12=DER:${logotype.toString("hex")}`].join("\n"));
  openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "mark.key", "-out", "mark.csr", "-subj", "/O=Example Org/CN=Example Org");
  openssl("x509", "-req", "-in", "mark.csr", "-CA", `${issuer}.pem`, "-CAkey", `${issuer}.key`, "-CAcreateserial", "-days", "3650", "-extfile", "mark.cnf", "-extensions", "mark", "-out", "mark.pem");
  writeFileSync(new URL(out, import.meta.url), readFileSync(at("mark.pem"), "utf8") + readFileSync(at(`${issuer}.pem`), "utf8"));
};

authority("Test");
authority("Stranger");
writeFileSync(new URL("root.pem", import.meta.url), readFileSync(at("Test.pem")));
mark("Test", "vmc.pem");
mark("Stranger", "stranger.pem");
rmSync(work, { recursive: true });
