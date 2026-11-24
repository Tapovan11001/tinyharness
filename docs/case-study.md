# TinyHarness: building an agent loop from scratch

## The problem

Every AI agent is a loop: ask the model, run the tools it picks, send back the results, repeat. Frameworks hide that loop, which is fine until something breaks. When an agent burns through tokens calling the same tool over and over, or crashes because a tool got a string where it expected a number, you need to know exactly what the loop does at each step.

I wanted to understand that layer well enough to build it myself, and to make its behaviour visible to people who've never seen it.

## What I built

- A TypeScript harness (about 600 lines, no runtime dependencies) with tool calling, schema validation, timeouts, budgets, a repeat guard, an approval gate and a full event trace.
- A playground that renders the trace live, with six scenarios that each show one behaviour: multi-step tools, parallel calls, recovering from bad input, asking before acting, a tool that's down, and a runaway agent hitting its budget.
- An eval runner, plus a suite that runs those six scenarios as graded tests in CI.

## How it works

1. The model is behind a two-method interface (`name`, `complete()`), so the same loop runs against Claude or against a scripted model.
2. Before each step the harness checks three budgets: model calls, tool calls and tokens.
3. Tool calls are validated against their JSON schema first. Problems go back to the model as an error result with a readable message.
4. Each tool runs with a timeout. Exceptions and timeouts become error results.
5. If the same tool gets the same input too many times (key order ignored), the harness tells the model it's looping.
6. Tools marked `needsApproval` wait on a human. In the playground that's an inline Approve / Decline card.
7. Every one of these steps emits a trace event, which drives the UI, the CLI log and the evals.

## Result

- 10 unit tests and 6 scenario evals, all offline and deterministic, running in CI on every push.
- The playground works with no API key (Replay) or with your own key (Live).
- {{add a real number here once you have one, e.g. how many people tried the playground, or a live eval pass rate with Claude}}

## What I learned

- Most agent failures are boring: a wrong field name, a tool that's down, a model retrying the same thing. The harness matters more than the prompt for these.
- Returning errors to the model works. In the "bad input" scenario the model fixes its call on the next step without any special handling.
- Budgets need to be checked before each step, not after, or the step that crosses the line still costs money.

## Next

- Stream tokens into the trace.
- A "replay from trace" mode that re-runs a saved real run against changed tools.
- Run the evals against Claude in CI on a schedule and track the pass rate over time.
