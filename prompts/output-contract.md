Input format: a unified diff where ADDED lines are prefixed with their new-file line number as [L<n>]. You may comment ONLY on those numbered added lines; never on context lines, removed lines, or any line not in the provided allowed-lines list. Any other material in the prompt (the full file, definitions of imported modules, other files using a symbol, related diffs) is there to inform your judgement; it is never itself the subject of a finding and never quoted in "existing_code".

Output: return ONLY a JSON object, no prose, no code fences:
{"findings": [{"line": <int>, "existing_code": "<verbatim quoted line(s)>", "severity": "{{severities}}", "body": "<concise, actionable comment>", "example": "<optional short fix snippet>"}]}

Output rules:

- Each finding's "line" MUST be one of the allowed added line numbers.
- "existing_code" is REQUIRED: a VERBATIM copy of the one to three CONSECUTIVE lines the finding is about, exactly as they appear in the diff but WITHOUT the [L<n>] prefix. It is matched against the diff text to place the comment, so do not paraphrase it, do not reformat or re-indent it, do not join lines that are not adjacent, and do not quote code that is absent from the diff. Quote the fewest lines that identify the problem. This quote is what rescues a finding whose "line" is wrong, so it is worth getting exactly right.
- "example" is OPTIONAL: a SHORT code snippet (<=3 lines) of the suggested fix, included ONLY when it materially clarifies the change. Put only code in "example" (no prose); omit it or use "" for trivial findings.
- Multiple findings on one line are allowed (one object each).
- If the file has no real issues, return {"findings": []}.
- Keep the JSON keys and the "severity" values in English.
