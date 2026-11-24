import { Agent, scriptedModel, type ModelClient, type TraceEvent } from "../src/index.ts";
import { anthropicModel } from "../src/models/anthropic.ts";
import { SYSTEM, scenarios, type Scenario } from "../examples/scenarios.ts";
import { allTools } from "../examples/tools.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let mode: "demo" | "live" = "demo";
let current: Scenario = scenarios[0];
let controller: AbortController | null = null;

// ---------- scenario picker ----------
const list = $("scenarios");
for (const s of scenarios) {
  const b = document.createElement("button");
  b.className = "scn";
  b.type = "button";
  b.dataset.id = s.id;
  b.innerHTML = `<b></b><span></span>`;
  b.querySelector("b")!.textContent = s.title;
  b.querySelector("span")!.textContent = s.shows;
  b.addEventListener("click", () => select(s));
  list.append(b);
}

const steps = $<HTMLInputElement>("max-steps");
const repeats = $<HTMLInputElement>("max-repeats");
const syncOut = () => {
  $("max-steps-out").textContent = steps.value;
  $("max-repeats-out").textContent = repeats.value;
};
steps.addEventListener("input", syncOut);
repeats.addEventListener("input", syncOut);

function select(s: Scenario) {
  current = s;
  for (const b of list.querySelectorAll<HTMLButtonElement>(".scn")) b.setAttribute("aria-pressed", String(b.dataset.id === s.id));
  $<HTMLTextAreaElement>("prompt").value = s.prompt;
  steps.value = String(s.limits?.maxSteps ?? 12);
  repeats.value = String(s.limits?.maxRepeats ?? 3);
  syncOut();
  updateNote();
}

// ---------- mode toggle ----------
function setMode(m: typeof mode) {
  mode = m;
  $("mode-demo").classList.toggle("on", m === "demo");
  $("mode-live").classList.toggle("on", m === "live");
  $("mode-demo").setAttribute("aria-checked", String(m === "demo"));
  $("mode-live").setAttribute("aria-checked", String(m === "live"));
  $("live-panel").hidden = m !== "live";
  updateNote();
}
$("mode-demo").addEventListener("click", () => setMode("demo"));
$("mode-live").addEventListener("click", () => setMode("live"));

function updateNote() {
  $("mode-note").textContent =
    mode === "demo"
      ? "Replay mode: the model's turns are scripted so this runs without a key. The tools, validation, approvals and budgets are the real harness code."
      : "Live mode: Claude decides every step. Edit the task to see how it handles something new.";
}

try {
  const saved = sessionStorage.getItem("th-key");
  if (saved) $<HTMLInputElement>("api-key").value = saved;
} catch {}

// ---------- running ----------
const traceEl = $("trace");
let startedAt = 0;
let tokens = 0;

function stat(id: string, v: string) { $(id).textContent = v; }

function card(cls: string, tag: string, meta: string): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `ev ${cls}`;
  const h = document.createElement("div");
  h.className = "h";
  const t = document.createElement("span");
  t.className = "tag";
  t.textContent = tag;
  const m = document.createElement("b");
  m.textContent = meta;
  h.append(t, m);
  li.append(h);
  traceEl.append(li);
  li.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return li;
}
function addText(li: HTMLElement, text: string, pre = false) {
  const el = document.createElement(pre ? "pre" : "p");
  el.textContent = text;
  li.append(el);
}

function onEvent(e: TraceEvent) {
  stat("s-time", `${(Date.now() - startedAt).toLocaleString()} ms`);
  switch (e.kind) {
    case "model_call": {
      tokens += e.usage.inputTokens + e.usage.outputTokens;
      stat("s-steps", String(e.step));
      stat("s-tokens", tokens.toLocaleString());
      const li = card("model", `model #${e.step}`, `${e.stopReason} · ${e.usage.inputTokens} in / ${e.usage.outputTokens} out · ${e.ms} ms`);
      if (e.text) addText(li, e.text);
      break;
    }
    case "tool_call": {
      stat("s-tools", String(Number($("s-tools").textContent) + 1));
      const li = card("tool", "tool call", e.name);
      addText(li, JSON.stringify(e.input, null, 2), true);
      break;
    }
    case "tool_result": {
      const li = card(e.isError ? "err" : "result", e.isError ? "error result" : "result", `${e.name} · ${e.ms} ms`);
      addText(li, e.output, true);
      break;
    }
    case "approval":
      break; // the approval card is drawn by approve() below
    case "budget_stop": {
      const li = card("stop", "harness stop", "budget");
      addText(li, `Stopped: ${e.reason}.`);
      break;
    }
    case "error": {
      const li = card("err", "error", "run failed");
      addText(li, friendlyError(e.message));
      break;
    }
    case "run_end": {
      const s = $("s-status");
      s.textContent = e.status.replace("_", " ");
      s.className = `v st-${e.status}`;
      if (e.output) {
        $("answer").hidden = false;
        $("answer-text").textContent = e.output;
      }
      break;
    }
  }
}

function friendlyError(msg: string): string {
  if (/401|authentication|x-api-key/i.test(msg)) return "The API key was rejected. Check it and try again.";
  if (/fetch|network|Failed to fetch|Connection error/i.test(msg))
    return `Couldn't reach the Claude API from this page (${msg}). If you're viewing a preview that blocks outside requests, open the hosted site instead.`;
  return msg;
}

/** Approval gate: renders an inline card and waits for a click. */
function approve(call: { name: string; input: unknown }): Promise<boolean> {
  return new Promise((resolve) => {
    const li = card("ask", "needs approval", call.name);
    addText(li, JSON.stringify(call.input, null, 2), true);
    const row = document.createElement("div");
    row.className = "ask-row";
    const yes = document.createElement("button");
    yes.className = "yes";
    yes.textContent = "Approve";
    const no = document.createElement("button");
    no.textContent = "Decline";
    const done = (ok: boolean) => {
      row.replaceWith(Object.assign(document.createElement("p"), { textContent: ok ? "Approved." : "Declined." }));
      resolve(ok);
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    row.append(yes, no);
    li.append(row);
    controller?.signal.addEventListener("abort", () => done(false));
  });
}

$("run").addEventListener("click", async () => {
  let model: ModelClient;
  if (mode === "live") {
    const key = $<HTMLInputElement>("api-key").value.trim();
    if (!key) {
      $<HTMLInputElement>("api-key").focus();
      $("mode-note").textContent = "Paste an Anthropic API key to run live, or switch to Replay.";
      return;
    }
    try { sessionStorage.setItem("th-key", key); } catch {}
    model = anthropicModel({ apiKey: key, browser: true, model: $<HTMLSelectElement>("model-id").value, maxTokens: 4000 });
  } else {
    const typed = $<HTMLTextAreaElement>("prompt").value.trim();
    if (typed !== current.prompt) {
      $("mode-note").textContent = "Replay mode can only play the scenario's original task. Switch to Live to try your own.";
      return;
    }
    model = scriptedModel(current.script, { delayMs: 450 });
  }

  traceEl.replaceChildren();
  $("answer").hidden = true;
  ["s-steps", "s-tools", "s-tokens"].forEach((id) => stat(id, "0"));
  stat("s-status", "running");
  $("s-status").className = "v";
  tokens = 0;
  startedAt = Date.now();
  controller = new AbortController();
  $<HTMLButtonElement>("run").disabled = true;
  $<HTMLButtonElement>("stop").disabled = false;

  const agent = new Agent({
    model,
    system: SYSTEM,
    tools: allTools,
    limits: { maxSteps: Number(steps.value), maxRepeats: Number(repeats.value) },
    onEvent,
    approve,
  });
  try {
    await agent.run($<HTMLTextAreaElement>("prompt").value.trim(), controller.signal);
  } finally {
    $<HTMLButtonElement>("run").disabled = false;
    $<HTMLButtonElement>("stop").disabled = true;
    controller = null;
  }
});
$("stop").addEventListener("click", () => controller?.abort());

select(scenarios[0]);
setMode("demo");
