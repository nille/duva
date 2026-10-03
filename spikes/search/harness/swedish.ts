// Swedish mail, generated for the benchmark mailbox so that Swedish words sit
// next to Enron's English ones. A seeded generator writes the same messages on
// every run: everyday topics, where each topic's words come in several of
// their forms (faktura, fakturan, fakturor, fakturorna), as real mail has them.
import type { CorpusMessage } from "./enron.ts";

interface Topic {
  subjects: string[];
  sentences: string[];
  senders: string[];
}

const topics: Topic[] = [
  {
    subjects: ["Faktura för {month}", "Fakturan för {month} är försenad", "Fråga om fakturorna", "Påminnelse: obetald faktura"],
    sentences: [
      "Här kommer fakturan för {month}.",
      "Fakturan ska vara betald senast den {day} {month}.",
      "Vi har inte fått betalt för de två senaste fakturorna.",
      "Kan du kontrollera att beloppet på fakturan stämmer?",
      "Alla fakturor skickas från och med nu som PDF.",
      "Betalningen har kommit in, tack så mycket.",
      "Om fakturan redan är betald kan du bortse från det här meddelandet.",
      "Beloppet är {amount} kronor inklusive moms.",
    ],
    senders: ["ekonomi@bostadsbolaget.example", "faktura@elbolaget.example", "redovisning@byran.example"],
  },
  {
    subjects: ["Möte på {weekday}", "Mötet flyttas", "Protokoll från mötet", "Inför styrelsemötet"],
    sentences: [
      "Vi ses på mötet på {weekday} klockan {hour}.",
      "Mötet flyttas till {weekday} eftersom flera är sjuka.",
      "Bifogat finns protokollet från förra mötet.",
      "Har du möjlighet att leda mötet i stället för mig?",
      "Vi behöver gå igenom budgeten innan nästa styrelsemöte.",
      "Möten på fredagar fungerar dåligt för de flesta.",
      "Skicka gärna punkter till dagordningen senast i morgon.",
      "Mötesrummet på tredje våningen är bokat hela eftermiddagen.",
    ],
    senders: ["lena.berg@foreningen.example", "styrelsen@brf-linden.example", "anders.lund@kontoret.example"],
  },
  {
    subjects: ["Resan till {city}", "Bokningsbekräftelse: tåg till {city}", "Hotellet i {city}", "Ändrad avgång"],
    sentences: [
      "Tåget till {city} går klockan {hour} från centralstationen.",
      "Jag har bokat hotellet för två nätter i {city}.",
      "Biljetterna finns bifogade i det här mejlet.",
      "Avgången är tyvärr inställd, och vi har bokat om dig till nästa tåg.",
      "Glöm inte att ta med passet.",
      "Resorna betalas av projektet, spara kvittona.",
      "Flyget landar i {city} strax efter lunch.",
      "Frukost serveras mellan sju och tio.",
    ],
    senders: ["bokning@tagresor.example", "info@hotellet.example", "maria.ek@kontoret.example"],
  },
  {
    subjects: ["Leveransen är försenad", "Din beställning har skickats", "Fråga om leveransen", "Retur av varan"],
    sentences: [
      "Din beställning skickades i dag och beräknas komma fram på {weekday}.",
      "Leveransen är tyvärr försenad med några dagar.",
      "Paketet kan hämtas hos ombudet med legitimation.",
      "Vill du returnera varan fyller du i blanketten och skickar tillbaka den.",
      "Vi har fått flera klagomål på leveranserna den senaste veckan.",
      "Spårningsnumret hittar du längre ner i mejlet.",
      "Pengarna betalas tillbaka inom fem bankdagar.",
    ],
    senders: ["kundtjanst@butiken.example", "leverans@posten.example", "order@verktyg.example"],
  },
  {
    subjects: ["Semesterplanering", "Ledig i {month}?", "Semesterlistan", "Sommarstängt"],
    sentences: [
      "Skriv upp dina semesterveckor på listan innan fredag.",
      "Jag är ledig hela {month} och svarar inte på mejl.",
      "Vi har sommarstängt under veckorna 28 till 31.",
      "Kan någon täcka upp för mig medan jag är på semester?",
      "Semestrarna måste godkännas av din chef.",
      "Vi hyr en stuga vid havet i två veckor.",
    ],
    senders: ["personal@kontoret.example", "johan.nilsson@kontoret.example", "sara.holm@kontoret.example"],
  },
  {
    subjects: ["Kalas på lördag", "Inbjudan till födelsedagskalas", "Middag hos oss?", "Midsommar"],
    sentences: [
      "Välkommen på kalas hos oss på lördag klockan {hour}.",
      "Ella fyller sju år och vill gärna att ni kommer.",
      "Säg till om ni är allergiska mot något.",
      "Vi firar midsommar i stugan som vanligt, ta med sill och jordgubbar.",
      "Barnen kan bada om det är varmt, ta med handdukar.",
      "Ska vi äta middag hos oss på {weekday}?",
    ],
    senders: ["anna.svensson@familjen.example", "erik.forsberg@familjen.example", "farmor@familjen.example"],
  },
  {
    subjects: ["Felanmälan: tvättstugan", "Vattenläcka i källaren", "Hissen är trasig", "Reparation av taket"],
    sentences: [
      "Tvättmaskinen i tvättstugan har gått sönder igen.",
      "Det läcker vatten i källaren under trappan.",
      "Hissen står still mellan tredje och fjärde våningen.",
      "En reparatör kommer på {weekday} mellan åtta och tolv.",
      "Reparationerna av taket börjar i {month}.",
      "Felanmälningar görs i första hand via hemsidan.",
    ],
    senders: ["fastighet@brf-linden.example", "felanmalan@hyresvarden.example", "vicevard@brf-linden.example"],
  },
  {
    subjects: ["Offert på målning", "Ny offert", "Offerten för köket", "Jämförelse av offerter"],
    sentences: [
      "Här är vår offert på målning av fasaden.",
      "Offerten gäller i trettio dagar.",
      "Vi har fått in tre offerter och den billigaste är på {amount} kronor.",
      "Priset i offerten inkluderar material och arbete.",
      "Kan ni skicka en uppdaterad offert med fler fönster?",
      "Jämför offerterna innan vi bestämmer oss.",
    ],
    senders: ["info@maleriet.example", "offert@snickeriet.example", "per.lind@byggfirman.example"],
  },
  {
    subjects: ["Föräldramöte", "Utvecklingssamtal", "Skolresan", "Information från skolan"],
    sentences: [
      "Föräldramötet hålls i matsalen på {weekday} klockan {hour}.",
      "Boka en tid för utvecklingssamtal via skolans hemsida.",
      "Skolresan går till {city} i slutet av {month}.",
      "Kom ihåg att barnen behöver matsäck på utflykten.",
      "Lärarna har studiedag och skolan är stängd.",
      "Fritids har öppet som vanligt under loven.",
    ],
    senders: ["rektor@skolan.example", "klasslararen@skolan.example", "fritids@skolan.example"],
  },
  {
    subjects: ["Ditt nya avtal", "Uppsägning av avtalet", "Avtalet om hyran", "Villkoren i avtalet"],
    sentences: [
      "Bifogat finns det nya avtalet för underskrift.",
      "Avtalet löper ut den sista {month}.",
      "Uppsägningstiden är tre månader enligt avtalet.",
      "Läs igenom villkoren och hör av dig om något är oklart.",
      "Båda avtalen behöver skrivas under innan årsskiftet.",
      "Hyran höjs med två procent enligt det nya avtalet.",
    ],
    senders: ["avtal@hyresvarden.example", "juristen@byran.example", "kund@forsakring.example"],
  },
];

const greetings = ["Hej!", "Hej {name},", "Hejsan,", "God morgon,", "Hej alla,"];
const closings = ["Med vänliga hälsningar", "Hälsningar", "Mvh", "Ha en bra dag", "Tack på förhand"];
const names = ["Anna", "Erik", "Maria", "Johan", "Lena", "Anders", "Sara", "Per", "Karin", "Lars", "Eva", "Mikael"];
const months = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const weekdays = ["måndag", "tisdag", "onsdag", "torsdag", "fredag"];
const cities = ["Göteborg", "Malmö", "Uppsala", "Umeå", "Luleå", "Visby", "Örebro", "Västerås"];

// mulberry32: small, fast and the same on every machine.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function swedishMessages(count: number, between: { from: Date; to: Date }): CorpusMessage[] {
  const next = random(1);
  const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)]!;
  const fill = (template: string) =>
    template
      .replaceAll("{month}", () => pick(months))
      .replaceAll("{weekday}", () => pick(weekdays))
      .replaceAll("{city}", () => pick(cities))
      .replaceAll("{name}", () => pick(names))
      .replaceAll("{day}", () => String(1 + Math.floor(next() * 28)))
      .replaceAll("{hour}", () => String(8 + Math.floor(next() * 11)))
      .replaceAll("{amount}", () => String(100 * (2 + Math.floor(next() * 400))));
  const span = between.to.getTime() - between.from.getTime();
  const messages: (CorpusMessage & { topic: Topic })[] = [];
  for (let i = 0; i < count; i++) {
    // About a third are replies to a recent message, on its topic.
    const earlier = messages.length && next() < 0.3 ? pick(messages.slice(-50)) : undefined;
    const topic = earlier?.topic ?? pick(topics);
    const subject = earlier ? `Sv: ${earlier.subject.replace(/^Sv: /, "")}` : fill(pick(topic.subjects));
    const sentences = Array.from({ length: 2 + Math.floor(next() * 4) }, () => fill(pick(topic.sentences)));
    const name = pick(names);
    const text = [fill(pick(greetings)), sentences.join(" "), `${pick(closings)}\n${name}`].join("\n\n");
    messages.push({
      id: `sv-${String(i + 1).padStart(5, "0")}`,
      sender: earlier ? pick(earlier.recipients) : pick(topic.senders),
      recipients: earlier ? [earlier.sender] : [`${name.toLowerCase()}@hemma.example`],
      subject,
      // A reply comes within three days of what it answers.
      date: new Date(earlier ? earlier.date.getTime() + Math.floor(next() * 3 * 86_400_000) : between.from.getTime() + Math.floor(next() * span)),
      hasAttachment: /bifoga/i.test(text),
      text,
      topic,
    });
  }
  return messages.map(({ topic: _, ...message }) => message);
}
