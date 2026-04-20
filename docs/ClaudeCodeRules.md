Claude Code Rules
Rule 1: Separate Concerns
Every file, function, and module should have ONE clear responsibility. If a function is doing two unrelated things, split it. If a file handles both UI rendering and database logic, break it apart.
Rule 2: Keep Files Small
Individual files should be 700 lines or less — ideally under 500 lines. If a file is growing past this, refactor it into smaller, focused modules.
Rule 3: Write Meaningful Unit Tests
Tests should verify actual behavior, not just exist for coverage. Test edge cases, error paths, and real-world scenarios — not just the happy path.
Rule 4: Don't Repeat Yourself (DRY)
If the same logic appears in more than one place, extract it into a shared function or module. Duplicated code means duplicated bugs.
Rule 5: Use Clear, Descriptive Names
No vague names like data, result, temp, handler, or utils. Names should reveal intent — a reader should understand what something does without reading its implementation.
Rule 6: Keep Coupling Loose
Modules should depend on each other as little as possible. If changing one file forces changes in five others, refactor to reduce those dependencies.
Rule 7: YAGNI — You Aren't Gonna Need It
Only build what is needed right now. Do not add speculative features, premature abstractions, or "just in case" code.
Rule 8: Handle Errors Explicitly
Every function that can fail should handle its errors consistently. No silent failures, no swallowed exceptions, no empty catch blocks.
Rule 9: No Magic Numbers or Strings
Hardcoded values like 86400, "admin", or 0.15 should be named constants. Example: SECONDS_IN_A_DAY = 86400.
Rule 10: Read Before You Write
Before modifying any file, read and understand the existing code patterns, naming conventions, and architecture. Match the style already in use — do not introduce new conventions without explicit discussion.

Periodic Code Review Checklist
Stop periodically and review the codebase for violations of the above rules. Specifically check for:
	•	Files exceeding 500 lines
	•	Functions doing more than one thing
	•	Duplicated logic across files
	•	Vague or misleading names
	•	Tight coupling between modules
	•	Missing or shallow tests
	•	Unhandled error paths
	•	Magic numbers or hardcoded strings
