---
name: Test: edit_scratch Tool
description: Verification test plan for the edit_scratch LM tool
agent: agent
tools:
  - vlkoti.scratch-code/list_scratches
  - vlkoti.scratch-code/read_scratch
  - vlkoti.scratch-code/write_scratch
  - edit_scratch
  - get_scratch_outline
---

Follow every step in #file:../../src/ai-test/edit_scratch.md exactly as written.

After completing all steps (including cleanup of test fixtures), write a structured test report to `scratch:///projects/scratch-code/test-results/edit-scratch.md` using `write_scratch`. Use this format:

```
# Test Report: edit_scratch
Date: <today>

## Summary
<PASS / PARTIAL / FAIL> — <one-line verdict>

## Step Results
- Step 1 (Create fixtures): PASS/FAIL — <note>
- Step 2 (Get outlines): PASS/FAIL — <note>
- Step 3 (append): PASS/FAIL — <note>
- Step 4 (insert): PASS/FAIL — <note>
- Step 5 (replace range): PASS/FAIL — <note>
- Step 6 (delete via replace): PASS/FAIL — <note>
- Step 7 (multi-op same file): PASS/FAIL — <note>
- Step 8 (batch across files): PASS/FAIL — <note>
- Step 9 (error handling): PASS/FAIL — <note>

## Unexpected Behaviour
<list any deviation from expected results, or "None">

## Assessment
<overall quality and usability verdict>
```
