// Run the playground scenarios as an eval suite.
//
//   npm run eval            -> scripted model (free, offline, deterministic; used in CI)
//   LIVE=1 npm run eval     -> real Claude model (needs ANTHROPIC_API_KEY; costs money)
import { Agent, formatReport, runEvals, scriptedModel, type EvalCase } from "../src/index.ts";
import { anthropicModel } from "../src/models/anthropic.ts";
import { SYSTEM, scenarios } from "./scenarios.ts";
import { allTools } from "./tools.ts";

const live = process.env.LIVE === "1";

const checks: Record<string, EvalCase["check"]> = {
  split: (r) => (/Arjun pays Riya ₹4,400/.test(r.output) && /Dev pays Kabir ₹1,600/.test(r.output)) || `unexpected settlement: ${r.output}`,
  parallel: (r) => /Germany is cheapest|US is cheapest|Dubai is cheapest/i.test(r.output) || "no cheapest country named",
  recover: (r) => r.output.includes("2,761.2") || `expected total 2,761.20, got: ${r.output}`,
  approval: (r) => r.trace.some((e) => e.kind === "approval") || "send_message ran without asking",
  flaky: (r) => (r.status === "done" && /down|unavailable|can't|cannot/i.test(r.output)) || "agent did not report the outage",
  runaway: (r) => r.status === "budget_exceeded" || `expected budget stop, got ${r.status}`,
};

const cases: EvalCase[] = scenarios.map((s) => ({ id: s.id, name: s.title, input: s.prompt, check: checks[s.id] }));

const report = await runEvals(cases, (c) => {
  const s = scenarios.find((x) => x.id === c.id)!; // live mode ignores the script
  return new Agent({
    model: live ? anthropicModel() : scriptedModel(s.script),
    system: SYSTEM,
    tools: allTools,
    limits: s.limits,
    approve: () => false, // never auto-approve side effects in evals
  });
});

console.log(formatReport(report));
process.exit(report.passed === report.total ? 0 : 1);
