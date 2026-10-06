// The fixed query set every latency run uses (#17), on the benchmark mailbox.
// Words, names and phrases come from the corpus, and senders are among its
// busiest. Nearly every query leaves out Spam and Trash, as Duva's default
// does, and the filters rotate through label, sender, date and attachment.
import type { SearchEvent } from "../src/lambda.ts";

type Query = SearchEvent["query"];
type Filters = NonNullable<Query["filters"]>;

export const limit = 20;

const notSpamOrTrash: Filters = { labels: { exclude: ["Spam", "Trash"] } };
const inbox: Filters = { labels: { include: ["Inbox"] } };
const year = (y: number): Filters["date"] => ({ from: `${y}-01-01T00:00:00.000Z`, to: `${y + 1}-01-01T00:00:00.000Z` });
const from = (sender: string): Filters => ({ ...notSpamOrTrash, sender });

// One filter combination per query, in turn.
const rotation: Filters[] = [
  notSpamOrTrash,
  inbox,
  { ...notSpamOrTrash, date: year(2001) },
  { ...notSpamOrTrash, hasAttachment: true },
  { labels: { include: ["Finance"], exclude: ["Spam", "Trash"] }, date: { from: "2000-01-01T00:00:00.000Z", to: "2001-07-01T00:00:00.000Z" } },
];
const rotate = <T extends object>(queries: T[]) => queries.map((q, i) => ({ ...q, filters: rotation[i % rotation.length], limit }));

const singleWords = ["pipeline", "invoice", "california", "turbine", "derivatives", "bankruptcy", "football", "golf", "merger", "faktura", "budget", "lunch", "weather", "isda", "storage"];
const wordPairs = ["gas prices", "credit rating", "power plant", "conference call", "trading floor", "price cap", "board meeting", "employee stock", "natural gas", "interview schedule", "legal review", "rate case", "wine dinner", "protokoll mötet", "transmission capacity"];
const names = ["kenneth lay", "skilling", "fastow", "sara shackleton", "vince kaminski", "jeff dasovich", "louise kitchen", "john arnold", "kay mann", "tana jones"];

const keyword: Query[] = [
  ...rotate([...singleWords, ...wordPairs, ...names].map((words) => ({ words }))),
  { words: "isda master agreement", filters: from("sara.shackleton@enron.com"), limit },
  { words: "electricity", filters: { ...from("jeff.dasovich@enron.com"), date: year(2001) }, limit },
  { words: "model", filters: from("vince.kaminski@enron.com"), limit },
  { words: "spam", filters: { labels: { include: ["Spam"] } }, limit },
];

const phrases = [
  "wholly owned subsidiary of",
  "plan to attend the",
  "to discuss this issue",
  "office of the chair",
  "the final draft of",
  "the supreme court has",
  "phase of the project",
  "sent on behalf of",
  "due to the lack",
  "choose their electricity provider",
  "some of the best",
  "was sent to you",
  "orders and instructions please",
  "please let me know",
  "out of the office",
  "kan ni skicka",
  "conference call",
  "the attached file",
  "natural gas",
  "price caps",
];
const phrase: Query[] = [
  ...rotate(phrases.map((phrase) => ({ phrase }))),
  { phrase: "credit support annex", filters: from("sara.shackleton@enron.com"), limit },
  { phrase: "california public utilities commission", filters: from("jeff.dasovich@enron.com"), limit },
];

// Filtered vector queries: every one has a filter, label, sender and date
// among them.
export const meanings = [
  "pipeline capacity for natural gas into California",
  "who is in the fantasy football league this season",
  "what happens to employees' retirement savings after the bankruptcy",
  "styrelsen vill gå igenom budgeten",
  "a reminder to sign the contract",
  "travel plans for the conference",
  "complaints about the new expense report system",
  "hiring a summer intern for the research group",
  "the regulator's decision on electricity rates",
  "drinks after work on friday",
  "fixing a mistake in yesterday's trades",
  "an offer to buy the company",
  "när kommer fakturan",
  "weather forecast affecting demand",
  "a request for a legal opinion on a swap",
];
const vector: Query[] = [
  ...rotate(meanings.map((meaning) => ({ meaning }))),
  { meaning: "negotiating terms with a counterparty", filters: from("sara.shackleton@enron.com"), limit },
  { meaning: "rolling blackouts and the state's response", filters: { ...from("jeff.dasovich@enron.com"), date: year(2001) }, limit },
  { meaning: "a paper about pricing options", filters: from("vince.kaminski@enron.com"), limit },
  { meaning: "a schedule for gas deliveries", filters: { ...from("chris.germany@enron.com"), hasAttachment: true }, limit },
  { meaning: "an urgent question from the boss", filters: { ...inbox, date: year(2001) }, limit },
];

// Hybrid: words that must be there, plus what the mail is about.
const hybrid: Query[] = [
  ...rotate(
    [
      ["california", "who is to blame for the power crisis"],
      ["enron", "layoffs and severance after the collapse"],
      ["gas", "a problem with nominations at a delivery point"],
      ["contract", "waiting for the other side's comments"],
      ["meeting", "moving the meeting to another day"],
      ["model", "valuing weather derivatives"],
      ["faktura", "betalningen är försenad"],
      ["golf", "a weekend tournament with clients"],
      ["credit", "a counterparty's credit getting worse"],
      ["dinner", "celebrating a colleague's promotion"],
      ["isda", "signing a master agreement with a bank"],
      ["power", "buying electricity for next summer"],
      ["stock", "the share price falling"],
      ["resume", "applying for a job in the trading group"],
      ["deal", "a mistake in a booked trade"],
    ].map(([words, meaning]) => ({ words, meaning })),
  ),
  { words: "agreement", meaning: "changes to the collateral terms", filters: from("sara.shackleton@enron.com"), limit },
  { words: "ferc", meaning: "price caps across the western states", filters: { ...from("jeff.dasovich@enron.com"), date: year(2001) }, limit },
  { words: "research", meaning: "recruiting students from a university", filters: from("vince.kaminski@enron.com"), limit },
  { words: "deal", meaning: "the volumes for next month", filters: { ...from("chris.germany@enron.com"), hasAttachment: true }, limit },
  { words: "please", meaning: "an invitation to a party", filters: { ...inbox, date: year(2000) }, limit },
];

// Duva's search as its words give it (#67): the same words searched as words
// and as a meaning, also translated into each of three search languages, the
// most Duva has, so three translations at once.
const translated: Query[] = hybrid.slice(0, 15).map(({ meaning, filters }) => ({ words: meaning, meaning, translateInto: ["English", "Swedish", "Danish"], filters, limit }));

// Vector and hybrid queries run twice: with the vector index, and as a flat
// scan that compares every vector.
export const queryTypes = {
  keyword: { queries: keyword, flatVectorSearch: false },
  phrase: { queries: phrase, flatVectorSearch: false },
  vector: { queries: vector, flatVectorSearch: false },
  "vector-flat": { queries: vector, flatVectorSearch: true },
  hybrid: { queries: hybrid, flatVectorSearch: false },
  "hybrid-flat": { queries: hybrid, flatVectorSearch: true },
  translated: { queries: translated, flatVectorSearch: false },
};

export type QueryType = keyof typeof queryTypes;
