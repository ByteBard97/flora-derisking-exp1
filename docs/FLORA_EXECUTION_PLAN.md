# Flora Experiment Execution Plan

**Status:** Execution plan for running the derisking experiments
**Date:** April 2026
**Companion document:** `FLORA_DERISKING_EXPERIMENTS_v2.md` (defines *what* to build; this document defines *how* to run it)
**Scope assumptions:**
- Solo engineer
- Dedicated spikes repo (separate from the eventual Flora production repo)
- Weekly scheduled review with Annie
- Clean-break migration (no Illustrator import)
- Total budget: 4–6 weeks

This plan defines the operational wrapper around the experiments: repo setup, weekly rhythm, artifact management, Annie-review protocol, failure escalation, and the transition from spikes to production. The technical content of each experiment lives in the derisking document — this one does not restate it.

---

## 1. Repo Setup

### Create a dedicated spikes repo

Name: `flora-spikes` (or similar). Public or private is your choice; private is fine since these won't be published artifacts.

Initial structure:

```
flora-spikes/
├── README.md                    # points to the two canonical docs
├── docs/
│   ├── FLORA_ARCHITECTURE_SPEC.md
│   ├── FLORA_DERISKING_EXPERIMENTS_v2.md
│   └── execution-plan.md        # this document
├── infrastructure/              # Experiment 0 lives here
│   ├── eslint-config/
│   ├── coordinate-tests/
│   └── README.md
├── experiment-1/                # Rendering & drag POC
├── experiment-2/                # Bed tool + worker
├── experiment-3/                # Export gates
├── measurements/                # one subdirectory per experiment
│   ├── exp-1/
│   ├── exp-2/
│   └── exp-3/
└── annie-reviews/               # notes + assets from weekly reviews
    ├── week-1.md
    └── ...
```

**Each experiment directory is self-contained.** Its own `package.json`, its own Vite config, its own `README.md`. Experiment 2 may copy code from Experiment 1 as a starting point — that's fine. Do not try to share a monorepo setup between experiments; it creates coupling where you want isolation.

**Commit discipline:** check in spike code frequently, even ugly state. This is your own archaeology later. You will want to see "what did I try on Tuesday" when Thursday's approach fails.

### Why NOT the production repo

If spikes live in the production repo, three bad things happen:
- The spike code accrues legitimacy and you can't delete it without "removing real work"
- Git history pollutes the production repo with throwaway commits
- Conditional passes and workarounds migrate into production silently

Separate repo, clean import later. The migration step at the end of this document is where spike artifacts become production code intentionally, not accidentally.

---

## 2. Week-by-Week Schedule

This is a target schedule. Slippage is expected; below I describe how to handle it. The schedule assumes you work on this roughly full-time during the spike period. If it's a side project, multiply by 2–3x.

### Week 0 (prep — 2 days)

- Create the spikes repo
- Copy the architecture spec and v2 derisking doc into `docs/`
- Schedule the six weekly Annie reviews on the calendar before you start — putting them on the calendar first makes them real
- Confirm Annie's computer specs for the hardware target; arrange access for measurement days
- Identify the real aerial photo / parcel / DEM composite you'll use in Experiment 1 (a real lot Annie has worked on is ideal; failing that, pick a public parcel you can pull from Sarasota County GIS manually)
- Identify the reference deliverable you'll use in Experiment 3 (one of Annie's past PDFs, with permission)

If Week 0 takes longer than 2 days, stop and examine why — it's often a sign that the clean-break or hardware-target decisions aren't fully settled.

### Week 1: Experiment 0 + start of Experiment 1

- **Days 1–2:** Experiment 0 (lint rule + coordinate unit tests)
- **Days 3–5:** Experiment 1 scaffolding — Vue 3 + Vite + Pinia + Konva installed, `docStore` with 300 procedural plants, `viewportStore` with conversions, single Konva Stage with three layers, background image loading

**Annie review #1 (end of Week 1):** show her the lint rule rationale, the coordinate test output, and the bare Konva canvas rendering 300 plants. No interaction yet. The goal of this review is to align on what "done" looks like for Experiment 1, not to demo functionality.

### Week 2: Experiment 1 completion

- **Days 1–2:** Projection service, click-to-select, Transformer
- **Days 3–4:** Live-drag with drag-harvest pattern, undo stack
- **Day 5:** Measurements on Annie's hardware — all seven checks, recorded numerically

**Annie review #2 (end of Week 2):** show working drag, undo, and consistency assertion running. If measurements pass, verbally confirm go-decision. If conditional pass, show her the required optimizations and whether the UX still feels right.

### Week 3: Experiment 2

- **Days 1–2:** Web Worker scaffolding, Turf.js integration, @odiak/fit-curve vendoring
- **Days 3–4:** BedPenTool, fit pipeline, auto-close, area HUD
- **Day 5:** Anchor-drag, measurements

**Annie review #3 (end of Week 3):** have Annie draw 10 real planting beds with the tool. Measurement #1 (fit quality) is subjective — her reaction is the measurement. Measurement #7 (self-intersection rate) falls out naturally from her use.

### Week 4: Experiment 3 (PDF half)

- **Days 1–2:** `exportPDF` implementation, svg2pdf integration, font embedding
- **Day 3:** Generate test deliverables
- **Day 4:** Physical large-format print (requires access to a printer — arrange in Week 0)
- **Day 5:** Measurements 1–8

**Annie review #4 (end of Week 4):** show her the printed output. Her subjective evaluation ("can I hand this to a contractor?") is the real measurement. If it fails, this is the most likely place for serious slippage.

### Week 5: Experiment 3 (SVG half) + buffer

- **Days 1–2:** `exportSVG` implementation, semantic grouping, structure
- **Day 3:** Open in Illustrator and Inkscape, measurements 9–10
- **Days 4–5:** Buffer. Reserved for whatever slipped.

**Annie review #5 (end of Week 5):** show her the SVG imported into Illustrator. Can she edit it? Would she hand this off to a sign-maker?

### Week 6: Writeup + transition decisions

- **Days 1–2:** Write the final evidence-base document — measurements log, what was learned, what the architecture spec needs to update
- **Days 3–5:** Plan the production build based on what the experiments proved

**Annie review #6 (end of Week 6):** final verdict. Does she want the thing you just proved is buildable? This is the last check before serious money gets spent.

---

## 3. Weekly Annie Review Protocol

Weekly reviews are the most expensive part of this plan if done wrong and the highest-leverage part if done right. Some discipline:

### Before each review, write a one-page agenda

Format:

```markdown
# Annie Review — Week N

## What I built this week
- bullet list, concrete

## What I measured
- table of measurements, pass/fail

## What I want from you
- [ ] review the X decision
- [ ] try doing Y and tell me how it feels
- [ ] answer: [specific question]

## What I am NOT asking you about
- UI polish
- species picker
- anything outside this experiment's scope
```

The "what I am NOT asking about" section protects you from scope creep and protects her from feeling like she needs to evaluate things that aren't ready.

### During the review

- Keep it to 30 minutes. Weekly reviews that drift past an hour become dreaded and get skipped.
- Show, don't tell. Every session should include a live demo on real hardware.
- Record her reactions verbatim if they're about UX feel. "It felt laggy when I dragged the third plant" is data; your interpretation of it is not.
- If she asks for features outside scope, write them down in an `out-of-scope-requests.md` file and move on. Do not build them.

### After each review

- Write `annie-reviews/week-N.md` with: what you showed, what she said, what decisions came out of it, what changed in the plan
- If the review produced a product decision (e.g., the self-intersection behavior question in Experiment 2), record it explicitly in the architecture spec, not just in the review notes

### If Annie can't make a review

Reschedule within the same week if possible. If not, write the agenda anyway, record a Loom walkthrough, and keep moving. Don't block experiment work on review availability.

---

## 4. Measurement Discipline

### Every measurement is a file, not a memory

When you take a measurement — FPS during pan, PDF generation time, anything — write it down immediately in `measurements/exp-N/`:

```markdown
# Experiment 1, Measurement 1 — Sustained FPS during pan/zoom

**Date:** 2026-04-28
**Hardware:** Annie's computer (Dell XPS 13, 2021, Intel i7-1165G7, 16GB, integrated Iris Xe, 1920x1200 display)
**Browser:** Chrome 128
**Build:** spike commit 7a3b2f1

## Procedure
Loaded exp-1 scaffold, 300 procedural plants + 1.2MB background PNG.
Chrome DevTools Performance tab, recording mode.
Continuous pan at ~200px/sec for 10 seconds, then zoom in/out for 10 seconds.

## Result
Pan: 58–60fps sustained, 1 frame spike to 22ms at zoom transition
Zoom: 54–59fps sustained

## Verdict
PASS

## Notes
Sprite caching (node.cache()) was required; without it, pan drops to ~40fps.
This is now a required optimization; adding to architecture spec.
```

These files are the evidence base. In month six when someone asks "is Konva fast enough?", you point at this file, not at your memory of how it felt.

### When a measurement is ambiguous

Some measurements are inherently subjective — Experiment 2 Measurement 1 ("fit quality") depends on what a reasonable bezier fit looks like. When ambiguous:

- Take a screenshot or screen recording. Check it in.
- Record Annie's reaction verbatim in her review notes.
- Write the verdict as "PASS — per Annie review week 3, fit quality is acceptable; see annie-reviews/week-3.md"

The ambiguity doesn't go away by being recorded — but it stops being a surprise later.

### When you want to skip a measurement

You will be tempted. The PDF physical-print measurement is the likeliest skip target because it requires printer access and feels like overhead. Skipping it turns Experiment 3 from a gate into theater. If you're tempted to skip, stop and ask: is this measurement wrong, or is it inconvenient? If it's wrong, write that down and propose an alternative. If it's inconvenient, do it anyway.

---

## 5. Failure Escalation

Solo means no one else to escalate to — you are the decision-maker. But "decision-maker" doesn't mean "decide in the moment." Some decisions should be slept on.

### Mid-experiment failures (a measurement fails)

When a measurement fails:

1. **Do not pivot the same day.** Write up what failed. Sleep on it.
2. **The next day, try the documented fallback** (e.g., if FPS fails, try sprite caching before declaring Konva wrong).
3. **If the fallback doesn't fix it, escalate to a weekly-review-scheduled decision.** Don't pivot to Pixi.js on a Wednesday afternoon — bring it to Annie on Friday with the measurement evidence and the proposed alternative.

The rule: **no architectural pivots without sleeping on it.** The cost of a wrong pivot (week of work wasted) far exceeds the cost of a day's delay.

### Experiment-level failures (a whole experiment fails)

When an experiment fails its go/no-go:

1. Stop. Don't start the next experiment.
2. Write a failure report: what failed, why, what the candidate alternatives are
3. Bring to Annie review as a dedicated topic
4. Return to the architecture spec and identify what needs to change
5. Re-estimate timeline

The experiments are designed so that a failure in Experiment 1 doesn't waste work on 2 and 3. Respect that design — don't start Experiment 2 hoping Experiment 1 will retroactively pass.

### When you're stuck mid-day

Solo engineers get stuck differently than team engineers — nobody to rubber-duck with. Workarounds:

- Write the question in a file as if you were asking someone else. The act of writing often reveals the answer.
- Take a walk. 30-minute breaks after 2 hours stuck are almost always net-positive.
- If still stuck end of day, write the problem as a 200-word description and stop. Return to it fresh.

---

## 6. Scope Discipline Defenses

Solo engineer + spike repo + weekly reviews = three scope creep vectors. Here's how to resist them.

### Vector 1: Feature temptation ("while I'm in here…")

You're implementing the drag logic and notice that snapping would be easy to add. Don't. The experiment is testing drag without snapping. Snapping is an open question with its own design work. Adding it:
- Changes the measurement (is the lag from drag, or from snap computation?)
- Delays the experiment
- Creates a precedent for future "while I'm in here" additions

**Rule:** if it's not in the experiment's "scope" section of the v2 doc, it doesn't ship in the spike.

### Vector 2: Polish temptation

Spike code should look like spike code. Unstyled buttons, console.log for observability, no error states. If you catch yourself writing CSS for hover states on the experiment toolbar, stop. That's 30 minutes that buys you nothing.

**Rule:** if the measurement doesn't depend on it, don't polish it.

### Vector 3: Annie temptation

At weekly reviews, Annie will have opinions and ideas. Many will be great. None of them belong in the spikes.

**Rule:** capture everything in `out-of-scope-requests.md`. Tell her explicitly "I wrote that down and it'll land in the production plan, not the spike." She's not getting brushed off; the request is getting correctly routed.

---

## 7. Transition from Spikes to Production

At the end of Week 6, you have:
- Working spike code for each experiment (ugly, throwaway-quality)
- A measurements log (the evidence base)
- An updated architecture spec (with all conditional-pass conditions documented)
- Annie review notes (the product context)
- An `out-of-scope-requests.md` (the starting v1 backlog)

**Do NOT copy the spike code into the production repo.** It was written fast, under different constraints, with different conventions. Reading it back and "cleaning it up into production" is slower than rewriting from scratch with the lessons learned.

Instead:

1. **Create the production Flora repo fresh.**
2. **Start from the architecture spec as the design doc** — it should by now reflect every finding from the experiments.
3. **Reference the spike code as you go.** Open Experiment 1's `CanvasProjection` in a separate tab when writing production's version. Copy patterns, not files.
4. **The lint rule and coordinate tests port directly.** Those are infrastructure, not spike code.
5. **Keep the spikes repo checked in forever.** It's the evidence base. Never delete it.

The production Flora build plan is a separate document that gets written at the end of Week 6, not now. Its shape depends entirely on what the experiments actually proved.

---

## 8. What Could Go Wrong With This Plan

Being honest about the ways this plan can break, so you see them coming:

**Solo burnout around Week 4.** Experiment 3 is the longest and least satisfying (a lot of fiddling with svg2pdf and fonts). Energy typically drops here. Mitigation: the Week 5 buffer exists partly for this. Don't skip it if you don't need it for Experiment 3 — use the time to recover.

**Annie unavailability.** If she travels or gets busy, reviews slip, and the feedback loop collapses. Mitigation: record Loom walkthroughs if she can't attend. But if she's unavailable for 2+ consecutive weeks, stop and reschedule the whole spike window. Experiments without user feedback are experiments in name only.

**Measurements getting skipped under time pressure.** This is the single biggest threat to the plan's value. If you start skipping measurements in Week 3 because "they're passing clearly," you'll skip them in Week 4 when they matter. Mitigation: write the measurement template once in Week 1 and make it easier to fill out than to skip.

**Getting sucked into one experiment.** Experiment 2's bezier fitting has infinite polish depth. Experiment 3's hatching can consume unlimited time. If an experiment blows past its budget by more than 2 days, stop and evaluate whether you're solving the experiment's actual question or a deeper problem.

**Discovering a better architecture mid-spike.** Possible. If it happens: document it in `annie-reviews/week-N.md` and the architecture spec, but **finish the current experiments anyway**. The original architecture still deserves the measurement. Starting a new spike arc mid-stream doubles the cost.

**Hardware target unavailable.** If Annie's computer isn't accessible, the measurements become ambiguous. Mitigation: the Week 0 prep explicitly requires confirming hardware access. If it can't be confirmed, renegotiate the plan before Week 1.

---

## 9. Definition of Done

The execution plan is complete when:

- [ ] All three experiments have documented pass/fail verdicts
- [ ] Measurements log exists for every measurement in the v2 derisking doc
- [ ] Architecture spec is updated with every conditional-pass condition, every learned finding, every design decision made during Annie reviews
- [ ] The six Annie review notes exist in `annie-reviews/`
- [ ] An `out-of-scope-requests.md` captures every feature Annie asked for that wasn't in scope
- [ ] A one-page summary document states: "Here's what was proven, here's what failed, here's what the production Flora plan looks like based on this"
- [ ] The spikes repo is in a state where someone else could read it and understand what was learned

If any of these are missing at the end of Week 6, extend by up to a week to complete them. Writing these up is not overhead — it's the whole point. The spikes without the writeup are just code nobody will remember why.

---

## 10. The Next Document (After Experiments Complete)

Once all three experiments pass (or fail in documented ways), the next document is the **Flora Production Build Plan**. It will define:

- Monorepo structure for production Flora
- Module boundaries (canvas, tools, panels, services, stores)
- Milestone definitions (what's v0.1, v0.5, v1.0)
- The v1 feature list, pruned from the full PRD based on what's actually shippable
- Backend integration plan
- Deployment target (Tauri? web-only? both?)
- Annie onboarding plan for dogfooding

That document cannot be written now because its shape depends on what the experiments prove. If Experiment 1 fails and the stack pivots to Pixi.js, the production plan looks different. If Experiment 3 fails and PDF goes server-side, the Django roadmap changes. If hatching can't be made to work client-side, the v1 feature list shrinks.

**Write that document at the end of Week 6, not before.** Attempting to write it sooner is the third-most expensive mistake this project could make (after skipping the experiments themselves and ignoring the measurements).

---

## Summary

- Dedicated spikes repo, separate from eventual production
- Weeks 0–6, structured week-by-week but with explicit buffer
- Six Annie reviews on the calendar up front
- Every measurement is a file; no verbal passes
- No architectural pivots without sleeping on it
- Scope creep defended on three fronts (features, polish, Annie requests)
- Transition to production is a fresh repo, not a copy-paste
- Production plan is written after experiments, not before

The v2 derisking document defines *what* to measure. This document defines *how* to operate while measuring. Between them: everything needed to run the spike period and end it with enough evidence to make the production commitment with confidence.

Run them. Measure. Decide from evidence.
