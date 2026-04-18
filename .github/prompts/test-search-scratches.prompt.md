---
name: Test: search_scratches Tool
description: Verification test plan for the search_scratches LM tool
agent: agent
tools:
  - vlkoti.scratch-code/list_scratches
  - vlkoti.scratch-code/read_scratch
  - vlkoti.scratch-code/write_scratch
  - vlkoti.scratch-code/search_scratches
---

Follow every step in #file:../../src/ai-test/search_scratches.md exactly as written.
Discover the tool, explore its parameters, and test as many usage patterns as you can.

After completing all tests, write a structured report to `scratch:///projects/scratch-code/test-results/search-scratches.md` using `write_scratch`. Use this format:

```
# Test Report: search_scratches
Date: <today>

## Summary
<PASS / PARTIAL / FAIL> — <one-line verdict>

## Use Cases Tested
For each tested use case:
- Input parameters used
- Expected result
- Actual result: PASS/FAIL — <note>

## Unexpected Behaviour
<list any deviation from expected results, or "None">

## Assessment
<overall quality and usability verdict, including description completeness>
```
