---
name: Test: scratch URI Scheme Consistency
description: Verification test plan for scratch:// URI scheme consistency across LM tools
agent: agent
tools:
  - vlkoti.scratch-code/list_scratches
  - vlkoti.scratch-code/read_scratch
  - vlkoti.scratch-code/write_scratch
  - vlkoti.scratch-code/search_scratches
---

Follow every step in #file:../../src/ai-test/scratch_uri_scheme.md exactly as written.

After completing all steps, write a structured test report to `scratch:///projects/scratch-code/test-results/scratch-uri-scheme.md` using `write_scratch`. Use this format:

```
# Test Report: scratch URI Scheme Consistency
Date: <today>

## Summary
<PASS / PARTIAL / FAIL> — <one-line verdict>

## Step Results
- Step 1 (list_scratches output format): observations + PASS/FAIL per check item
- Step 2 (Both URI forms via read_scratch): PASS/FAIL per check item
- Step 3 (filter accepts both forms): PASS/FAIL per tool and URI form
- Step 4 (search_scratches output paths): PASS/FAIL + observations

## Unexpected Behaviour
<list any deviation from expected results, or "None">

## Assessment
<overall consistency verdict — do both URI forms work everywhere?>
```
