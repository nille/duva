// A stand-in for the uploads bucket in S3: multipart uploads, presigned URLs that work until they
// expire, CORS for a browser on another origin, and the lifecycle rule that gives up an upload a
// day after it started. Its URLs lead under `url`, where the harness passes requests on to it.
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { UploadedPart, UploadsBucket } from "../src/uploads-bucket.ts";

interface Started {
  key: string;
  type: string;
  at: number;
  parts: Map<number, Uint8Array>;
}

const day = 24 * 60 * 60 * 1000;

export function memoryUploadsBucket(url: () => string): UploadsBucket & {
  /** Answers a request to one of the bucket's URLs, as S3 does, or undefined if it isn't one. */
  handle(request: Request): Promise<Response | undefined>;
  /** The files the bucket keeps, as text. */
  files(): string[];
  /** How many uploads were neither completed nor given up. */
  incomplete(): number;
  /** Gives up each upload started more than a day before the time, as the bucket's lifecycle rule does. */
  lifecycle(at: Date): void;
} {
  const objects = new Map<string, { body: Uint8Array<ArrayBuffer>; type: string }>();
  const uploads = new Map<string, Started>();
  const secret = randomUUID();
  const signature = (fields: string[]) => createHmac("sha256", secret).update(fields.join("\n")).digest("hex");
  const signed = (method: string, key: string, query: Record<string, string>, expires: Date) => {
    const params = new URLSearchParams({ ...query, expires: String(expires.getTime()) });
    params.set("signature", signature([method, key, params.toString()]));
    return `${url()}${key.split("/").map(encodeURIComponent).join("/")}?${params}`;
  };
  const denied = () => new Response("<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>", { status: 403, headers: { "content-type": "application/xml" } });
  return {
    async start(key, type) {
      const id = randomUUID();
      uploads.set(id, { key, type, at: Date.now(), parts: new Map() });
      return id;
    },
    async partUrls(key, upload, parts, expires) {
      return Array.from({ length: parts }, (_, index) => signed("PUT", key, { uploadId: upload, partNumber: String(index + 1) }, expires));
    },
    async parts(key, upload) {
      const started = uploads.get(upload);
      if (started?.key !== key) return undefined;
      return [...started.parts].sort(([a], [b]) => a - b).map(([number, body]): UploadedPart => ({ number, size: body.byteLength, etag: etagOf(body) }));
    },
    async complete(key, upload, parts) {
      const started = uploads.get(upload);
      if (started?.key !== key) throw new Error("NoSuchUpload");
      const bodies = parts.map(({ number, etag }) => {
        const body = started.parts.get(number);
        if (body === undefined || etagOf(body) !== etag) throw new Error("InvalidPart");
        return body;
      });
      objects.set(key, { body: new Uint8Array(Buffer.concat(bodies)), type: started.type });
      uploads.delete(upload);
    },
    async get(key) {
      return objects.get(key)?.body;
    },
    async has(key) {
      return objects.has(key);
    },
    async downloadUrl(key, { name, type }, expires) {
      return signed("GET", key, { "response-content-type": type, ...(name !== undefined && { "response-content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` }) }, expires);
    },
    async remove(prefix) {
      for (const key of [...objects.keys()]) if (key.startsWith(prefix)) objects.delete(key);
      for (const [id, { key }] of [...uploads]) if (key.startsWith(prefix)) uploads.delete(id);
    },
    async handle(request) {
      const address = new URL(request.url);
      if (!request.url.startsWith(url())) return undefined;
      const origin = request.headers.get("origin");
      // The bucket's CORS rule lets the web app PUT parts and read their ETags.
      const cors: Record<string, string> = origin === null ? {} : { "access-control-allow-origin": origin, "access-control-expose-headers": "ETag" };
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 200,
          headers: { ...cors, "access-control-allow-methods": "PUT, GET", "access-control-allow-headers": request.headers.get("access-control-request-headers") ?? "*", "access-control-max-age": "3600" },
        });
      }
      const key = address.pathname.slice(new URL(url()).pathname.length).split("/").map(decodeURIComponent).join("/");
      const params = new URLSearchParams(address.search);
      const given = params.get("signature");
      params.delete("signature");
      if (given !== signature([request.method, key, params.toString()]) || Number(params.get("expires")) <= Date.now()) return withHeaders(denied(), cors);
      if (request.method === "PUT") {
        const started = uploads.get(params.get("uploadId") ?? "");
        if (started?.key !== key) return new Response("<Error><Code>NoSuchUpload</Code></Error>", { status: 404, headers: { ...cors, "content-type": "application/xml" } });
        const body = new Uint8Array(await request.arrayBuffer());
        started.parts.set(Number(params.get("partNumber")), body);
        return new Response(null, { status: 200, headers: { ...cors, etag: etagOf(body) } });
      }
      const object = objects.get(key);
      if (request.method !== "GET" || object === undefined) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404, headers: { ...cors, "content-type": "application/xml" } });
      const disposition = params.get("response-content-disposition");
      return new Response(object.body, { headers: { ...cors, "content-type": params.get("response-content-type") ?? object.type, ...(disposition !== null && { "content-disposition": disposition }) } });
    },
    files: () => [...objects.values()].map(({ body }) => new TextDecoder().decode(body)),
    incomplete: () => uploads.size,
    lifecycle(at) {
      for (const [id, { at: started }] of [...uploads]) if (started <= at.getTime() - day) uploads.delete(id);
    },
  };
}

const etagOf = (body: Uint8Array) => `"${createHash("md5").update(body).digest("hex")}"`;

function withHeaders(response: Response, headers: Record<string, string>) {
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}
