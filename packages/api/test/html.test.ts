import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/**
 * A deployment on example.com where ada, the first admin, sponsors the agent Hermes, which owns a
 * mailbox at hermes@example.com. `read` hands SES the message for Hermes and returns it as Hermes
 * reads it.
 */
async function withMailbox() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };
  const read = async (raw: string) => {
    await duva.receive(raw, { to: ["hermes@example.com"] });
    const { data: list } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
    const { data: thread } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: list!.threads[0]!.id } } });
    return thread!.messages[0]!;
  };
  return { duva, hermes, params, read };
}

/** The header fields of a made-up newsletter from Lindvallens IF to Hermes. */
const fromLindvallen = [
  "From: Lindvallens IF <nyheter@lindvallen.example.net>",
  "To: hermes@example.com",
  "Subject: Matchdag mot Bergsjö",
  "Date: Sun, 04 Oct 2026 09:00:00 +0000",
  "Message-ID: <matchdag-7@lindvallen.example.net>",
  "MIME-Version: 1.0",
];

/** A made-up newsletter whose only body is the HTML. */
const newsletter = (html: string) =>
  [
    ...fromLindvallen,
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
  ].join("\r\n");

test("HTML mail is served without its scripts and event handlers, with its styles, images and links", async () => {
  const { read } = await withMailbox();

  const message = await read(
    newsletter(
      [
        `<html><head><title>Utskick 41</title><style>h1 { color: #1d3557; }</style><script>track("open");</script></head>`,
        `<body style="background: #f1faee">`,
        `<h1 onclick="track('click')">Matchdag mot Bergsjö</h1>`,
        `<img src="https://lindvallen.example.net/lag.jpg" alt="Laget" width="600" height="300" onerror="track('error')">`,
        `<p>Läs mer på <a href="https://lindvallen.example.net/matchdag" onmouseover="track('hover')">vår sida</a>.</p>`,
        `</body></html>`,
      ].join(""),
    ),
  );

  expect(message.html).toBe(
    [
      `<style>h1 { color: #1d3557; }</style>`,
      `<div style="background: #f1faee">`,
      `<h1>Matchdag mot Bergsjö</h1>`,
      `<img src="https://lindvallen.example.net/lag.jpg" alt="Laget" width="600" height="300" />`,
      `<p>Läs mer på <a href="https://lindvallen.example.net/matchdag">vår sida</a>.</p>`,
      `</div>`,
    ].join(""),
  );
  expect(message.removedTrackers).toEqual([]);
});

test("HTML mail is served without forms, frames, objects, embeds, a meta refresh, or javascript: and data: links, keeping data: images", async () => {
  const { read } = await withMailbox();

  const message = await read(
    newsletter(
      [
        `<html><head><meta http-equiv="refresh" content="0; url=https://lindvallen.example.net/"><base href="https://lindvallen.example.net/"></head><body>`,
        `<form action="https://lindvallen.example.net/anmalan" method="post"><input name="namn"><button>Anmäl</button></form>`,
        `<iframe src="https://lindvallen.example.net/karta"></iframe>`,
        `<object data="https://lindvallen.example.net/film.swf"></object><embed src="https://lindvallen.example.net/film.swf">`,
        `<p><a href="javascript:track('click')">Biljetter</a> <a href="data:text/html,<b>hej</b>">Program</a> <a href="mailto:kansliet@lindvallen.example.net">Kansliet</a></p>`,
        `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Logga" width="120" height="40">`,
        `<img src="data:text/html;base64,PGI+aGVqPC9iPg==" alt="Inte en bild" width="120" height="40">`,
        `</body></html>`,
      ].join(""),
    ),
  );

  expect(message.html).toBe(
    [
      `<div>`,
      `<p><a>Biljetter</a> <a>Program</a> <a href="mailto:kansliet@lindvallen.example.net">Kansliet</a></p>`,
      `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Logga" width="120" height="40" />`,
      `<img alt="Inte en bild" width="120" height="40" />`,
      `</div>`,
    ].join(""),
  );
});

test("known trackers are removed and listed by service, and images hidden or of 0 or 1 pixel as a hidden image", async () => {
  const { read } = await withMailbox();

  const message = await read(
    newsletter(
      [
        `<p>Hej!</p>`,
        `<img src="https://lindvallen.us21.list-manage.com/track/open.php?u=abc&id=def" width="600" alt="Mailchimp vet, Intuit äger">`,
        `<img src="https://u123.ct.sendgrid.net/wf/open?upn=xyz" alt="">`,
        `<img src="https://lindvallen.example.net/p.gif" width="1" height="1" alt="">`,
        `<img src="https://lindvallen.example.net/q.gif" width="0px" alt="">`,
        `<img src="https://lindvallen.example.net/r.gif" style="height: 1px; width: 600px" alt="">`,
        `<img src="https://lindvallen.example.net/s.gif" style="display:none" alt="">`,
        `<img src="https://lindvallen.example.net/t.gif" hidden alt="">`,
        `<img src="https://lindvallen.example.net/u.gif" width="01" alt="">`,
        `<img src="https://lindvallen.example.net/v.gif" style="width: 0em" alt="">`,
        `<img src="https://lindvallen.example.net/w.gif" style="opacity: 0" alt="">`,
        `<img src="https://lindvallen.example.net/x.gif" style="visibility: collapse" alt="">`,
        `<img src="https://lindvallen.example.net/y.gif" style="width:/* liten */1px" alt="">`,
        `<img src="https://lindvallen.example.net/lag.jpg" width="600" height="300" alt="Laget">`,
      ].join(""),
    ),
  );

  expect(message.html).toBe(`<p>Hej!</p><img src="https://lindvallen.example.net/lag.jpg" width="600" height="300" alt="Laget" />`);
  expect(message.removedTrackers).toEqual(["Intuit", "SendGrid", ...Array(10).fill("a hidden image")]);
});

test("a known tracker in a background or a style's url() is removed and listed by service, as MailTrackerBlocker finds them in CSS", async () => {
  const { read } = await withMailbox();

  const message = await read(
    newsletter(
      [
        `<style>.sidhuvud { background-image: url("https://eoapxl.com/a/open?u=1"); }</style>`,
        `<table background="https://emltrk.com/abc123?e=hermes"><tr><td style="background: url(https://lindvallen.example.net/gras.jpg)">Matchdag</td></tr></table>`,
      ].join(""),
    ),
  );

  expect(message.html).toBe(
    `<style>.sidhuvud { background-image: none; }</style><table><tr><td style="background: url(https://lindvallen.example.net/gras.jpg)">Matchdag</td></tr></table>`,
  );
  expect(message.removedTrackers).toEqual(["Email on Acid", "Litmus"]);
});

/** A made-up newsletter with its logo as a part of its own, which its HTML shows through `cid:`. */
const withLogo = (html: string) =>
  [
    ...fromLindvallen,
    'Content-Type: multipart/related; boundary="del"',
    "",
    "--del",
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
    "--del",
    "Content-Type: image/png",
    "Content-ID: <logga@lindvallen.example.net>",
    "Content-Disposition: inline",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("PNG logga").toString("base64"),
    "--del--",
  ].join("\r\n");

test("an image of the message's own part, by cid:, leads to a download link to it, however small", async () => {
  const { duva, read } = await withMailbox();

  const message = await read(withLogo(`<img src="cid:logga@lindvallen.example.net" alt="Logga"><img src="cid:logga@lindvallen.example.net" width="1" height="1" alt="">`));

  const [, logo, spacer] = message.html!.match(/^<img src="([^"]+)" alt="Logga" \/><img src="([^"]+)" width="1" height="1" alt="" \/>$/) ?? [];
  expect(message.removedTrackers).toEqual([]);
  expect(message.attachments).toEqual([{ type: "image/png", size: 9 }]);
  for (const link of [logo, spacer]) {
    const download = await duva.download(link!);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    expect(await download.text()).toBe("PNG logga");
  }
});

test("an image by cid: of a part the message doesn't have is served without its source", async () => {
  const { read } = await withMailbox();

  const message = await read(withLogo(`<img src="cid:vapen@lindvallen.example.net" alt="Vapen">`));

  expect(message.html).toBe(`<img alt="Vapen" />`);
});

test("a message is served without trackers while the stored copy keeps them, so a newer tracker list reaches old mail", async () => {
  const { duva, read } = await withMailbox();

  const message = await read(newsletter(`<p>Hej!</p><img src="https://u123.ct.sendgrid.net/wf/open?upn=xyz" alt=""><script>track("open");</script>`));

  expect(message.html).toBe(`<p>Hej!</p>`);
  expect(duva.stored()).toEqual([expect.stringContaining(`<img src="https://u123.ct.sendgrid.net/wf/open?upn=xyz" alt=""><script>track("open");</script>`)]);
});

test("a message with only plain text has no HTML and lists no trackers", async () => {
  const { read } = await withMailbox();

  const message = await read(
    [
      "From: Grace Hopper <grace@example.org>",
      "To: hermes@example.com",
      "Subject: Anteckningar",
      "Message-ID: <anteckningar@example.org>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "<img src=https://u123.ct.sendgrid.net/wf/open?upn=xyz> står det i loggen.",
    ].join("\r\n"),
  );

  expect(message.text).toBe("<img src=https://u123.ct.sendgrid.net/wf/open?upn=xyz> står det i loggen.");
  expect(message).not.toHaveProperty("html");
  expect(message).not.toHaveProperty("removedTrackers");
});

test("a text part that holds an HTML document is served as HTML too", async () => {
  const { read } = await withMailbox();

  const message = await read(await readFile(new URL("mail/html-as-text.eml", import.meta.url), "utf8"));

  expect(message.html).toBe(
    [
      `<style>\nbody { font-family: Georgia, serif; color: #1d3557; }\n.knapp { padding: 8px 16px; }\n</style>\n\n\n`,
      `<div>\n<style>.dold { display: none; }</style>\n<h1>Matchdag mot Bergsjö</h1>\n<p>Avspark klockan <b>15.00</b> på Lindvallen. Ta med fikakorg!</p>\n\n</div>`,
    ].join(""),
  );
});

test("other images in styles and backgrounds stay, and url() outside CSS is text", async () => {
  const { read } = await withMailbox();
  const html = [
    `<style>.topp { background-image: url(https://cdn.lindvallen.example.net/t/img/topp.jpg); }</style>`,
    `<table background="https://cdn.lindvallen.example.net/t/img/gras.jpg"><tr><td>Skriv url(https://emltrk.com/x) i rutan.</td></tr></table>`,
  ].join("");

  const message = await read(newsletter(html));

  expect(message.html).toBe(html);
  expect(message.removedTrackers).toEqual([]);
});

test("javascript: and data: URLs other than images are removed from styles and image sets", async () => {
  const { read } = await withMailbox();

  const message = await read(
    newsletter(
      [
        `<style>.a { background: url("javascript:track()"); } .b { background: url(data:text/html,hej); } .c { background: url(data:image/png;base64,AAAA); }</style>`,
        `<p style="background-image: url(javascript:track())">Hej</p>`,
        `<img src="https://lindvallen.example.net/lag.jpg" srcset="data:text/html,hej 2x" alt="Laget">`,
      ].join(""),
    ),
  );

  expect(message.html).toBe(
    [
      `<style>.a { background: none; } .b { background: none; } .c { background: url(data:image/png;base64,AAAA); }</style>`,
      `<p style="background-image: none">Hej</p>`,
      `<img src="https://lindvallen.example.net/lag.jpg" alt="Laget" />`,
    ].join(""),
  );
});

test("a stylesheet a newsletter links to stays, for its fonts, and other links in its head go", async () => {
  const { read } = await withMailbox();

  const message = await read(
    newsletter(
      [
        `<html><head><link rel="stylesheet" href="https://fonts.example.net/css?family=Lato"><link rel="preconnect" href="https://fonts.example.net">`,
        `<style>@font-face { font-family: Lindvallen; src: url(https://fonts.example.net/lindvallen.woff2); }</style></head>`,
        `<body><p style="font-family: Lato, Lindvallen">Hej</p></body></html>`,
      ].join(""),
    ),
  );

  expect(message.html).toBe(
    [
      `<link rel="stylesheet" href="https://fonts.example.net/css?family=Lato" />`,
      `<style>@font-face { font-family: Lindvallen; src: url(https://fonts.example.net/lindvallen.woff2); }</style>`,
      `<div><p style="font-family: Lato, Lindvallen">Hej</p></div>`,
    ].join(""),
  );
});

test("cid: in a style or a background leads to a download link to the part", async () => {
  const { duva, read } = await withMailbox();

  const message = await read(withLogo(`<style>.topp { background: url(cid:logga@lindvallen.example.net); }</style><table background="cid:logga@lindvallen.example.net"><tr><td>Hej</td></tr></table>`));

  const [, inStyle, inBackground] = message.html!.match(/^<style>\.topp \{ background: url\("([^"]+)"\); \}<\/style><table background="([^"]+)"><tr><td>Hej<\/td><\/tr><\/table>$/) ?? [];
  for (const link of [inStyle, inBackground]) expect(await (await duva.download(link!)).text()).toBe("PNG logga");
});
