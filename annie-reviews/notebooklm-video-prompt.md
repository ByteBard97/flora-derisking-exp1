# NotebookLM Video / Slideshow Prompt

## Documents to upload

Upload these documents to NotebookLM in this order (most important first):

1. `flora-story-for-notebooklm.md` — the primary narrative (in this folder)
2. `flora-v2-design-brief.md` — full product spec including Annie's persona and every feature
3. `pixi-feature-audit.md` — the feature checklist (what's proven, what's next)
4. `RISK-REGISTER.md` — the risk tracking document

---

## Prompt for the video / presentation

Use this as your NotebookLM prompt when generating the video or slide deck:

---

**Create a presentation video and slide deck for the following scenario:**

**Audience:** Annie, a native plant landscape designer and nursery owner in Sarasota, Florida. She went to art school. She has been designing residential landscapes for years using Adobe Illustrator as her drawing tool — she knows the pen tool, layers, artboards, and stroke styles deeply. She is not a software engineer. She does not know what "WebGL," "bezier-js," or "Pixi.js" mean and she does not need to.

**Purpose:** Show Annie what has been built over the last two weeks and why it matters for her work. This is not a technical briefing. This is an excited friend saying "look what I made for you."

**Tone:** Warm, enthusiastic, and clear. Speak like a designer talking to another designer, not like an engineer presenting to a board. Use visual and sensory language. Reference Illustrator by name — she knows it, it's a compliment to acknowledge her expertise. Avoid all software engineering jargon.

**Length:** Approximately 4–6 minutes of video / 10–14 slides.

**Arc of the story — follow this narrative structure:**

1. **Opening — The friction** (1–2 slides): Start with Annie's world today. The 45-minute setup ritual before she can start designing. The spreadsheets. The assembling of proposals from three different apps. The moment a client asks "what will it look like in five years?" and there's no good answer. This isn't a criticism of Annie — it's a recognition that the tools she has were never built for her.

2. **The vision** (1–2 slides): Flora is the tool that should have existed for native plant designers. One application. Address in, site plan out. Draw the beds, fill them with plants, export the proposal. The computer knows the species, knows the soil, does the counting automatically.

3. **The two weeks of work** (4–6 slides): Walk through what was actually proven and built. For each capability, lead with what it means for Annie's workflow before mentioning what it is technically. Examples:
   - "The pen tool works exactly like Illustrator's — same corner anchors, same curve handles, same alt-click to break symmetry. If you can draw in Illustrator, you can draw in Flora."
   - "300 plant symbols on screen at once, each with its botanical illustration, species name, and a draggable label. It runs at 120 frames per second. It never slows down."
   - "You can sketch a bed boundary freehand and it smooths automatically into a clean professional curve."
   - "You can measure the exact length of a curved bed edge, the area of any polygon, or the distance between two points — all in real feet and inches at whatever scale your drawing is set to."
   - "The knife tool lets you split a bed into two zones by dragging a line across it."
   - "You can place text annotations directly on the canvas — dimension callouts, notes, species tags."

4. **The export story** (1 slide): The most important thing for a professional: the file you hand to a client. Flora will export a fully vector PDF — the kind that a printer or a client can zoom into at any size and it's still crisp. The plant schedule exports as a spreadsheet. The design is a professional deliverable, not a screenshot.

5. **What comes next** (1–2 slides): The foundation is built. What's coming: the plant library with 300+ native Florida species filtered by soil, sun, and wildlife value. The GIS site import — type an address and the parcel boundary and aerial photo appear automatically. The bed fill tool. The layer panel. The growth preview showing year-5 sizes.

6. **Closing** (1 slide): This tool is being built for Annie. Her workflow, her clients, her plants. The goal is to let her spend her time on the design — the part that requires her expertise and artistry — and let the software handle the rest.

**Visuals guidance:**
- If generating slides with placeholder image suggestions, suggest screenshots of the actual canvas (plant renderer with botanical illustrations, the pen tool drawing a bed shape, the freehand auto-smooth comparison, the measurement tool showing a distance readout).
- Use a color palette that feels like landscape architecture: deep greens, warm earth tones, the blue-grey of a site plan. Not corporate blue.
- Typography should feel like a design studio presentation, not a PowerPoint template.

**What to avoid:**
- Do not mention library names (bezier-js, Pixi.js, Vue, TypeScript, RDP, de Casteljau). These are invisible.
- Do not use the word "derisking" or "spike" or "prototype" — to Annie this is the tool, not a test.
- Do not frame this as a technical proof-of-concept. Frame it as a preview of something being built for her.
- Do not start with bullet points of features. Start with her story.

---

## For the Audio Overview specifically

If using NotebookLM's Audio Overview (two-host podcast format), use this additional guidance:

> "Generate a conversational audio overview for a landscape designer named Annie who uses Adobe Illustrator for her work. One host should take the role of explaining the project with genuine excitement — they built this and they're proud of it. The other host should ask the questions Annie would ask: 'But can it actually do everything Illustrator does?' 'What happens when I export it — can I still open it in Illustrator?' 'How does it know what plants to recommend?' Keep the conversation at the level of a designer, not an engineer. No jargon. Aim for 5–7 minutes."
