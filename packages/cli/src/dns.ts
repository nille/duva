// The real DNS behind deployment.ts: the system's resolver, through node:dns.
import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import type { Dns } from "./deployment.ts";

export const realDns: Dns = {
  async resolve(type, name) {
    try {
      switch (type) {
        case "MX":
          return (await resolveMx(name)).map(({ priority, exchange }) => `${priority} ${exchange}`);
        case "TXT":
          return (await resolveTxt(name)).map((strings) => strings.join(""));
        case "CNAME":
          return await resolveCname(name);
      }
    } catch (error) {
      // No such name, or no record of the type there: either way, no record.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTFOUND" || code === "ENODATA") return [];
      throw error;
    }
  },
};
