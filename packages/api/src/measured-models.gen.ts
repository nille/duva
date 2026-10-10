// Generated from packages/api/test/coo-answers.json and docs/research/coo-models.md by scripts/generate.ts. Do not edit. Run npm run generate.

/** Each model Coo's evaluation measured, its success by kind of work from 0 to 1, and its cost per task in US dollars. */
export const measuredModels = {
  "anthropic.claude-haiku-4-5-20251001-v1:0": {
    "success": {
      "conversation": 1,
      "drafting": 1,
      "triage": 0.75,
      "labelTask": 1,
      "refusal": 1
    },
    "costPerTask": 0.01987
  },
  "anthropic.claude-sonnet-5-5": {
    "success": {
      "conversation": 1,
      "drafting": 1,
      "triage": 1,
      "labelTask": 1,
      "refusal": 1
    },
    "costPerTask": 0.048097
  },
  "amazon.nova-2-lite-v1:0": {
    "success": {
      "conversation": 0.6,
      "drafting": 0.5,
      "triage": 0.33,
      "labelTask": 0.75,
      "refusal": 1
    },
    "costPerTask": 0.008045
  },
  "amazon.nova-lite-v1:0": {
    "success": {
      "conversation": 0.6,
      "drafting": 0,
      "triage": 0.5,
      "labelTask": 0.83,
      "refusal": 1
    },
    "costPerTask": 0.000959
  },
  "amazon.nova-pro-v1:0": {
    "success": {
      "conversation": 1,
      "drafting": 0.17,
      "triage": 0.33,
      "labelTask": 0.5,
      "refusal": 1
    },
    "costPerTask": 0.018209
  }
} as const;
