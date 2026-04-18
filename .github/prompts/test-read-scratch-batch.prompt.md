---
name: Test: read_scratch Batch Feature
description: Verification test plan for the read_scratch batch read feature
agent: agent
tools:
  - vlkoti.scratch-code/list_scratches
  - vlkoti.scratch-code/read_scratch
  - get_scratch_outline
---

Follow every step in #file:../../src/ai-test/read_scratch_batch.md exactly as written.

After completing all steps including the description review, write a structured test report to `scratch:///projects/scratch-code/test-results/read-scratch-batch.md` using `write_scratch`. Use this format:

```
# Test Report: read_scratch Batch
Date: <today>

## Summary
<PASS / PARTIAL / FAIL> — <one-line verdict>

## Step Results
- Step 1 (Pick two scratches): files chosen
- Step 2 (Get outlines, plan ranges): PASS/FAIL — <note>
- Step 3 (Single reads): PASS/FAIL per check item
- Step 4 (Multi-file batch): PASS/FAIL per check item
- Step 5 (Two ranges same file): PASS/FAIL per check item
- Step 6 (Edge-case range labels): PASS/FAIL per label format
- Step 7 (Usability assessment): answers to the four questions
- Step 8 (Description review): comprehensiveness/redundancy notes

## Unexpected Behaviour
<list any deviation from expected results, or "None">

## Assessment
<overall quality and usability verdict>
```
