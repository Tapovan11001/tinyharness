# TinyHarness

A small agent harness in TypeScript. The whole core is about 600 lines with no runtime dependencies, and the loop itself is one file, [`src/agent.ts`](src/agent.ts).

**Playground:** {{live-url}} (runs without an API key in Replay mode)

I wanted to understand what frameworks like LangChain or the Claude Agent SDK actually do between "the model asked for a tool" and "here's your answer". So I wrote the smallest version I could that still handles the things that go wrong in real agents: bad tool inputs, tools that crash or hang, models that loop, and actions that need a human to say yes first.

## What it does

```
user task
   │
   ▼
┌──────────────┐  wants tools?  ┌──────────────────────────────┐
│  model call  │ ─────────────▶ │ validate input against schema │
└──────────────┘                │ repeat guard (same call x N)  │
   ▲     │ no                   │ approval gate (if marked)     │
   │     ▼                      │ run with timeout, catch errors│
   │   final answer             └──────────────┬───────────────┘
   │                                           │ all results in ONE message
   └───────────── budget check ◀───────────────┘
```

- **Tool loop.** Calls the model, runs whatever tools it asks for (in parallel), sends every result back in a single message, and repeats until the model answers.
- **Input validation.** Each tool declares a JSON schema. Bad input never reaches your code; the model gets a readable error like `input.expression is required` and usually fixes its own call on the next step.
- **Errors become results, not crashes.** A tool that throws or times out turns into an error result the model can work around. Unknown tool names get the list of real ones.
- **Budgets.** Hard limits on model calls, tool calls and total tokens. When one is hit the run stops with status `budget_exceeded` instead of burning money.
- **Repeat guard.** If the model calls the same tool with the same input (key order ignored) more than N times, it's told it's looping.
- **Approvals.** Mark a tool `needsApproval: true` and the harness waits on your `approve()` hook before running it. Declined actions are reported back so the model can offer an alternative.
- **Traces.** Every step is an event (`model_call`, `tool_call`, `tool_result`, `approval`, `budget_stop`, `error`, `run_end`) with timings and token counts. The playground is just a renderer for these.
- **Evals.** `runEvals()` runs a list of tasks on fresh agents and grades each with a plain function.
- **Swappable models.** The loop talks to a `ModelClient` interface. There's an adapter for the Claude API and a scripted model for tests and demos.

## Quick start

```bash
npm install
npm test          # 10 unit tests, offline
npm run eval      # 6 scenario evals against the scripted model
npm run dev       # playground at localhost:5173
```

Use it with Claude:

```ts
import { Agent, defineTool } from "./src/index.ts";
import { anthropicModel } from "./src/models/anthropic.ts";

const weather = defineTool<{ city: string }>({
  name: "weather",
  description: "Current temperature for a city",
  input: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  run: async ({ city }) => ({ city, tempC: 31 }),
});

const agent = new Agent({
  model: anthropicModel(), // reads ANTHROPIC_API_KEY
  system: "You are a helpful assistant.",
  tools: [weather],
  limits: { maxSteps: 8 },
});

const result = await agent.run("Is it hot in Delhi right now?");
console.log(result.status, result.output);
```

Or from the terminal: `ANTHROPIC_API_KEY=... node examples/cli.ts "your task"`. To run the evals against the real model: `LIVE=1 npm run eval`.

## Project layout

| Path | What's in it |
|---|---|
| `src/agent.ts` | The loop, budgets, repeat guard, approvals, timeouts |
| `src/schema.ts` | JSON schema subset validator for tool inputs |
| `src/tool.ts` | `defineTool()` and the wire format for tools |
| `src/models/anthropic.ts` | Claude adapter (prompt caching on, refusal fallback on) |
| `src/models/scripted.ts` | Scripted model for tests and Replay mode |
| `src/evals.ts` | Eval runner and report |
| `examples/` | Demo tools, scenarios, CLI, eval suite |
| `web/` | The playground (Vite, no framework) |
| `tests/` | Unit tests using Node's built-in test runner |

## Design choices

**Why write the loop by hand?** SDKs ship tool runners, and for a product I'd probably use one. The point here was to own every decision in the loop so I could test each one: what happens on bad input, on a timeout, on the fifth identical call.

**Why a scripted model?** Tests that hit a real model are slow, cost money and aren't deterministic. The scripted model replays fixed turns (or computes them from the last tool result), so every harness behaviour has a free, repeatable test. The playground's Replay mode uses the same thing. Only the model's turns are scripted there; the tools, validation, approvals and budgets are the real code.

**Why errors as results?** A model can recover from "that tool is down" if you tell it. It can't recover from an exception that ended the run.

**Why answer parallel tool calls in one message?** Splitting the results of one turn across several messages teaches the model to stop making parallel calls.

## Limits

- The schema validator covers the subset tools actually use (types, required, enum, min/max, arrays, nested objects). No `$ref`, `oneOf` or string formats.
- No streaming yet. The trace updates per step, not per token.
- One conversation per `run()`. There's no memory between runs.

## Case study

See [docs/case-study.md](docs/case-study.md).

## License

MIT
