# How it works

An AI agent is a loop. You give it a task, it asks the AI model what to do, the model picks a tool (like a calculator), the tool runs, and the result goes back to the model. This repeats until the task is done. TinyHarness is that loop, written so anyone can read it. It also adds the safety parts real agents need: it checks every tool request before running it, turns crashes into messages the AI can fix, stops agents that loop or run too long, and asks a person before risky actions. The playground on this page shows every step as it happens.

_Created by Aarav Makhija._
