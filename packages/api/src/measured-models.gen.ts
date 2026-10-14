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
  "anthropic.claude-haiku-5-5": {
    "success": {
      "conversation": 1,
      "drafting": 1,
      "triage": 1,
      "labelTask": 1,
      "refusal": 1
    },
    "costPerTask": 0.003932
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
  "deepseek.v3.2": {
    "success": {
      "conversation": 0.7,
      "drafting": 0.75,
      "triage": 0.75,
      "labelTask": 1,
      "refusal": 1
    },
    "costPerTask": 0.013165
  },
  "zai.glm-5": {
    "success": {
      "conversation": 1,
      "drafting": 1,
      "triage": 0.75,
      "labelTask": 1,
      "refusal": 1
    },
    "costPerTask": 0.022481
  },
  "zai.glm-5.3": {
    "success": {
      "conversation": 1,
      "drafting": 1,
      "triage": 1,
      "labelTask": 1,
      "refusal": 1
    },
    "costPerTask": 0.021455
  },
  "openai.gpt-6-luna": {
    "success": {
      "conversation": 1,
      "drafting": 1,
      "triage": 1,
      "labelTask": 1,
      "refusal": 1
    },
    "costPerTask": 0.000489
  },
  "openai.gpt-6-sol": {
    "success": {
      "conversation": 1,
      "drafting": 1,
      "triage": 1,
      "labelTask": 1,
      "refusal": 1
    },
    "costPerTask": 0.016843
  },
  "openai.gpt-oss-120b-1:0": {
    "success": {
      "conversation": 1,
      "drafting": 1,
      "triage": 1,
      "labelTask": 0.25,
      "refusal": 1
    },
    "costPerTask": 0.003744
  },
  "xai.grok-4.7": {
    "success": {
      "conversation": 1,
      "drafting": 1,
      "triage": 0.75,
      "labelTask": 1,
      "refusal": 1
    },
    "costPerTask": 0.026283
  },
  "moonshotai.kimi-k2.5": {
    "success": {
      "conversation": 1,
      "drafting": 1,
      "triage": 1,
      "labelTask": 1,
      "refusal": 1
    },
    "costPerTask": 0.010635
  },
  "moonshotai.kimi-k3": {
    "success": {
      "conversation": 1,
      "drafting": 1,
      "triage": 0.75,
      "labelTask": 1,
      "refusal": 1
    },
    "costPerTask": 0.075976
  },
  "minimax.minimax-m2.5": {
    "success": {
      "conversation": 0.8,
      "drafting": 1,
      "triage": 0.75,
      "labelTask": 1,
      "refusal": 1
    },
    "costPerTask": 0.00794
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
  },
  "qwen.qwen3-235b-a22b-2507-v1:0": {
    "success": {
      "conversation": 0.7,
      "drafting": 0.75,
      "triage": 0,
      "labelTask": 0.88,
      "refusal": 1
    },
    "costPerTask": 0.003448
  }
} as const;
