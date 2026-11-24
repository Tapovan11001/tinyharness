import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent, defineTool, scriptedModel, lastToolResults, validate } from "../src/index.ts";

const add = defineTool<{ a: number; b: number }>({
  name: "add",
  description: "Add two numbers",
  input: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
  run: ({ a, b }) => a + b,
});

test("runs a tool and returns the final answer", async () => {
  const model = scriptedModel([
    { tools: [{ name: "add", input: { a: 2, b: 3 } }] },
    (req) => ({ text: `The answer is ${lastToolResults(req)[0]}.` }),
  ]);
  const r = await new Agent({ model, system: "", tools: [add] }).run("2+3?");
  assert.equal(r.status, "done");
  assert.equal(r.output, "The answer is 5.");
  assert.equal(r.toolCalls, 1);
  assert.equal(r.steps, 2);
});

test("invalid tool input becomes an error result, not a crash", async () => {
  const model = scriptedModel([
    { tools: [{ name: "add", input: { a: "two" } }] },
    (req) => ({ text: lastToolResults(req)[0] }),
  ]);
  const r = await new Agent({ model, system: "", tools: [add] }).run("x");
  assert.equal(r.status, "done");
  assert.match(r.output, /input.a must be a number/);
  assert.match(r.output, /input.b is required/);
  const res = r.trace.find((e) => e.kind === "tool_result");
  assert.ok(res && res.kind === "tool_result" && res.isError);
});

test("unknown tool and throwing tool are reported back to the model", async () => {
  const boom = defineTool({ name: "boom", description: "", input: { type: "object" }, run: () => { throw new Error("disk full"); } });
  const model = scriptedModel([
    { tools: [{ name: "nope", input: {} }, { name: "boom", input: {} }] },
    (req) => ({ text: lastToolResults(req).join(" | ") }),
  ]);
  const r = await new Agent({ model, system: "", tools: [boom] }).run("x");
  assert.match(r.output, /Unknown tool "nope"/);
  assert.match(r.output, /Tool failed: disk full/);
});

test("parallel tool calls are answered in a single user message", async () => {
  const model = scriptedModel([
    { tools: [{ name: "add", input: { a: 1, b: 1 } }, { name: "add", input: { a: 2, b: 2 } }] },
    { text: "done" },
  ]);
  const r = await new Agent({ model, system: "", tools: [add] }).run("x");
  const toolMsg = r.messages[2];
  assert.equal(toolMsg.role, "user");
  assert.ok(Array.isArray(toolMsg.content) && toolMsg.content.length === 2);
});

test("step budget stops a model that never finishes", async () => {
  let n = 0;
  const model = scriptedModel([() => ({ tools: [{ name: "add", input: { a: n++, b: 0 } }] })]);
  const r = await new Agent({ model, system: "", tools: [add], limits: { maxSteps: 4 } }).run("x");
  assert.equal(r.status, "budget_exceeded");
  assert.equal(r.steps, 4);
  assert.ok(r.trace.some((e) => e.kind === "budget_stop"));
});

test("repeat guard tells the model it is looping", async () => {
  const model = scriptedModel([
    { tools: [{ name: "add", input: { a: 1, b: 1 } }] },
    { tools: [{ name: "add", input: { b: 1, a: 1 } }] }, // same input, keys reordered
    (req) => ({ text: lastToolResults(req)[0] }),
  ]);
  const r = await new Agent({ model, system: "", tools: [add], limits: { maxRepeats: 1 } }).run("x");
  assert.match(r.output, /already called add with this exact input/);
});

test("tools that need approval are skipped when declined", async () => {
  let ran = false;
  const send = defineTool({ name: "send_email", description: "", input: { type: "object" }, needsApproval: true, run: () => { ran = true; } });
  const model = scriptedModel([{ tools: [{ name: "send_email", input: {} }] }, (req) => ({ text: lastToolResults(req)[0] })]);
  const r = await new Agent({ model, system: "", tools: [send], approve: () => false }).run("x");
  assert.equal(ran, false);
  assert.match(r.output, /declined/);
  assert.ok(r.trace.some((e) => e.kind === "approval" && !e.approved));
});

test("slow tools time out", async () => {
  const slow = defineTool({ name: "slow", description: "", input: { type: "object" }, timeoutMs: 20, run: () => new Promise((r) => setTimeout(r, 500)) });
  const model = scriptedModel([{ tools: [{ name: "slow", input: {} }] }, (req) => ({ text: lastToolResults(req)[0] })]);
  const r = await new Agent({ model, system: "", tools: [slow] }).run("x");
  assert.match(r.output, /timed out after 20ms/);
});

test("refusal and model errors end the run with the right status", async () => {
  const refuse = await new Agent({ model: scriptedModel([{ text: "", stopReason: "refusal" }]), system: "" }).run("x");
  assert.equal(refuse.status, "refused");
  const broken = { name: "broken", complete: async () => { throw new Error("529 overloaded"); } };
  const err = await new Agent({ model: broken, system: "" }).run("x");
  assert.equal(err.status, "error");
  assert.ok(err.trace.some((e) => e.kind === "error" && e.message.includes("overloaded")));
});

test("validate handles enums, arrays, ranges and extra fields", () => {
  const schema = {
    type: "object" as const,
    properties: { qty: { type: "integer" as const, minimum: 1 }, unit: { enum: ["kg", "g"] }, tags: { type: "array" as const, items: { type: "string" as const } } },
    additionalProperties: false,
  };
  assert.deepEqual(validate({ qty: 2, unit: "kg", tags: ["a"] }, schema), []);
  const p = validate({ qty: 0, unit: "lb", tags: [1], extra: true }, schema);
  assert.equal(p.length, 4);
});
