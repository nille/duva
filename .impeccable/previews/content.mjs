// Shared synthetic content for the direction previews. Every name and message is made up.
export const me = { name: "Nicklas", address: "nicklas@duva.nille.xyz" };
export const views = [
  { name: "Inbox", count: 3, current: true },
  { name: "Screener", count: 1, quiet: true },
  { name: "Sent" }, { name: "Drafts" }, { name: "All mail" }, { name: "Spam" }, { name: "Trash" },
];
export const labels = [{ name: "Family", count: 1 }, { name: "Receipts" }];
export const agents = [{ name: "Hermes", address: "hermes@duva.nille.xyz", count: 2 }];
export const threads = [
  { from: "Astrid Lindqvist", actor: "human", subject: "Middag på lördag?", snippet: "Hej! Vi tänkte grilla om vädret håller. Kan ni komma vid sex? Ta gärna med barnen.", time: "09:41", unread: true, label: "Family", open: true },
  { from: "Hermes", actor: "agent", subject: "Re: Offert för takbyte", snippet: "I asked Byggfirman Ek for a firm price and a start date in May.", time: "09:12", unread: true, waiting: true },
  { from: "SJ", actor: "human", subject: "Din bokning: Stockholm C till Göteborg C", snippet: "Fre 11 okt, 07:10 -> 10:05, vagn 4, plats 22. Biljetten finns i appen.", time: "08:30", unread: true },
  { from: "Grace Hopper", actor: "human", subject: "Notes from Thursday", snippet: "Attached the notes. Two open questions: is retention >= 30 days enough, and who can see Trash?", time: "Yesterday" },
  { from: "Kivra", actor: "human", subject: "Ny faktura från Ellevio", snippet: "Du har fått en faktura på 1 284 kr med förfallodag 31 oktober.", time: "Yesterday", label: "Receipts" },
  { from: "Lars Ek", actor: "human", subject: "Båtplatsen i sommar", snippet: "Hamnföreningen har öppnat anmälan. Ska vi dela plats igen?", time: "Mon" },
  { from: "Duva", actor: "duva", subject: "Hermes sent 4 messages this week", snippet: "All four were approved by you. One reply is waiting since this morning.", time: "Sun" },
];
export const thread = {
  subject: "Middag på lördag?",
  messages: [
    { from: "Nicklas", address: "nicklas@duva.nille.xyz", actor: "human", time: "Thu 18:02", folded: true, text: "Låter toppen! Vi kollar med barnen och återkommer." },
    { from: "Astrid Lindqvist", address: "astrid@lindqvist.se", actor: "human", time: "09:41", text: "Hej!\n\nVi tänkte grilla om vädret håller. Kan ni komma vid sex? Ta gärna med barnen, Elsa har frågat efter Moa hela veckan.\n\nOm det regnar flyttar vi in och kör tacos istället.\n\nKram,\nAstrid" },
  ],
};
export const approval = {
  agent: "Hermes", subject: "Re: Offert för takbyte", to: "info@byggfirmanek.se",
  original: "Hej Nicklas,\n\nTack för förfrågan. Vi kan lämna offert efter ett platsbesök. Passar det i nästa vecka?\n\nMvh Lars, Byggfirman Ek",
  draft: "Hej Lars,\n\nTack! Ett platsbesök passar bra tisdag eller onsdag efter klockan 15. Kan ni också ange ett ungefärligt startdatum i maj?\n\nVänliga hälsningar,\nNicklas",
  disclosure: "Sent by Hermes for Nicklas",
};
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
export const paras = (t) => t.split("\n\n").map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
