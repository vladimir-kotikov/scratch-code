---
name: Test: get_scratch_outline Tool
description: Verification test plan for the get_scratch_outline LM tool
agent: agent
tools:
  - vlkoti.scratch-code/list_scratches
  - vlkoti.scratch-code/read_scratch
  - get_scratch_outline
---

Follow every step in #file:../../src/ai-test/get_scratch_outline.md exactly as written.

After completing all steps and the description review, write a structured test report to `scratch:///projects/scratch-code/test-results/get-scratch-outline.md` using `write_scratch`. Use this format:

```
# Test Report: get_scratch_outline
Date: <today>

## Summary
<PASS / PARTIAL / FAIL> — <one-line verdict>

## Step Results
- Step 1 (Pick three scratches): PASS/FAIL — <files chosen>
- Step 2 (Read & build mental model): PASS/FAIL — <note>
- Step 3 (Call outline, compare): PASS/FAIL per check item — <note>
- Step 4 (Usability assessment): answers to the three questions
- Step 5 (Description review): comprehensiveness/redundancy notes

## Unexpected Behaviour
<list any deviation from expected results, or "None">

## Assessment
<overall quality and usability verdict>
```
