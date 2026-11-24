// Run one task against Claude from the terminal and print the trace.
//   ANTHROPIC_API_KEY=... node examples/cli.ts "Split ₹1,200 between 3 people, Asha paid all of it"
import { Agent, summarizeTrace } from "../src/index.ts";
import { anthropicModel } from "../src/models/anthropic.ts";
import { SYSTEM } from "./scenarios.ts";
import { allTools } from "./tools.ts";

const task = process.argv.slice(2).join(" ") || "What's 18% GST on ₹2,340, and the total?";
const agent = new Agent({
  model: anthropicModel(),
  system: SYSTEM,
  tools: allTools,
  approve: ({ name, input }) => {
    console.log(`(auto-declining ${name} ${JSON.stringify(input)} in CLI mode)`);
    return false;
  },
});
const result = await agent.run(task);
console.log(summarizeTrace(result.trace));
console.log("\n" + result.output);
