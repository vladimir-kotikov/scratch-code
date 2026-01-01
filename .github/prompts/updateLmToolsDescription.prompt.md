---
name: Update LM Tools Description
agent: agent
tools:
  ["vscode/vscodeAPI", "read/problems", "read/readFile", "edit", "search", "web/fetch", "memory"]
---

Add declarations of LM tools defined in #file:../../src/providers/lm.ts to the #file:../../package.json according to #vscodeAPI docs, filing all necessary fields, focusing on `modelDescription` and `inputSchema` to make sure the LM can use these tools effectively, specifically for `modelDescription`:

- What exactly does the tool do?
- What kind of information does it return?
- When should and shouldn't it be used?
- Describe important limitations or constraints of the tool.

and for `inputSchema`:

- what each parameter does
- how it relates to the tool's functionality.

If declarations for some of the tools already exist, make sure they are relevant and meet the criteria above.
