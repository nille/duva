# Which model should suggest the rest of a sentence?

Measurements for #156. Run on 2026-10-10 against Amazon Bedrock in account 925039213717, from a throwaway Lambda in eu-north-1 (1,024 MB, Node 22) that `scripts/measure-suggestions.ts` creates and deletes. Each model was called as the API calls it, with the prompt the API builds (`packages/api/src/suggestions.ts`), on the 30 drafts of `scripts/suggestion-drafts.json`, 3 times each, after two calls to warm the connection. The raw answers are in `docs/research/suggestion-measurements.json`.

## Short answer

**Qwen3 32B is the default.** It is the only candidate near 400 ms at p95, and of the fast ones it most often begins the rest of the sentence as the writer did. It runs on demand in eu-north-1, so the draft stays in the region, and a suggestion costs about $0.000075, so a human taking 200 a day costs about $0.45 a month.

| Model | Called | p50 | p95 | Exactly as written | First words as written | Nothing | Per suggestion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-oss-20b | on demand in eu-north-1, reasoning effort low | 282 ms | 609 ms | 36% | 48% | 1% | $0.000053 |
| **Qwen3 32B** | on demand in eu-north-1 | 241 ms | **435 ms** | 30% | **56%** | 1% | $0.000075 |
| Amazon Nova Micro | `eu.` from eu-north-1 | 330 ms | 583 ms | 23% | 39% | 31% | $0.000017 |
| Claude Haiku 4.5 | `eu.` from eu-central-1 | 655 ms | 944 ms | 60% | 73% | 0% | $0.00054 |

- **Claude Haiku 4.5 writes the best suggestions by far,** and keeps them short, but takes twice as long, partly for the hop to eu-central-1, since Claude can't be called from eu-north-1 (docs/aws.md). Admins who want quality over speed can choose it, at seven times the price.
- **gpt-oss-20b is as fast at p50, but slower at p95,** and spends about 60 of its 78 output tokens reasoning even at low effort. Without `reasoning_effort: low` it spent all 60 of a trial's tokens reasoning and answered nothing.
- **Nova Micro often answers only the rest of the sentence,** without the words written, as the prompt asks for, so Duva can't tell where it goes on and offers nothing, a third of the time. It also signs off after the sentence. It is the cheapest.
- **Each suggestion also waits for Titan to embed what the memories are searched by:** 96 ms p50 and 138 ms p95 from the same Lambda. The API keeps the vector of a draft's subject and thread while it is warm, so most suggestions in a draft skip it.

## The drafts

30 drafts by one writer, a designer in Umeå with a partner, a daughter who plays football on Saturdays, a liking for meetings before lunch, and a style note on her greetings and sign-offs: 15 in English and 15 in Swedish. 14 answer a message, 2 forward one, and 14 are new mail. Each stops where she paused, after a word at the start or in the middle of a sentence (19), in the middle of a word (6), or in a sign-off (3), and says what she went on to write, to the sentence's end. Every draft was given the four memories and the style note.

## How it was scored

- **Exactly as written:** the suggestion has the same words as what she went on to write, ignoring case and punctuation, and starts a new word or goes on with the last one as she did.
- **First words as written:** its first two words are hers (all of them, for a shorter rest), which is what a human takes it for: a suggestion that begins right is taken with Tab, and the rest typed over.
- **Nothing:** the model answered nothing, or Duva couldn't tell where its answer goes on from what was written.
- **Latency:** the Converse call's time in the Lambda, with a warm connection. The p95 is over 90 calls. What a human waits for adds API Gateway, the authorizer, a few reads and writes of the table, and Titan when the draft's subject and message aren't embedded yet, so the real run measures it end to end.
- **Cost:** each call's input and output tokens at eu-north-1's prices, Claude's through `eu.`: gpt-oss-20b $0.07 and $0.30 per million, Qwen3 32B $0.15 and $0.60, Nova Micro $0.038 and $0.152, Claude Haiku 4.5 $1.10 and $5.50. A prompt was about 400 input tokens.

## What they got wrong

- **They add detail the draft doesn't give,** a time, a place or a reason: "since Elsa has a football match in the morning and I'd like to be there", "Lunch tomorrow sounds great, but I have a meeting at 11:30". The prompt asks for no detail the email doesn't give, but Qwen3 and gpt-oss still go on longer than the writer, and Haiku least.
- **Swedish fares about as well as English** for Qwen3 and Haiku. gpt-oss once wrote Markdown in the middle of a Swedish word ("gär**går.**").
- **The style note shows:** the models finished her Swedish sign-off as the note gives it, "Ha det fint, Ada", and Nova Micro signed off after most of its sentences.

## Measuring again

`AWS_REGION=eu-north-1 AWS_PROFILE=AWSAdministratorAccess-925039213717 node scripts/measure-suggestions.ts 3` measures again, at about $0.10 for all four models, and writes the raw answers. A model added to `suggestionModels` is measured with the rest.
