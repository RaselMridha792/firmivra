# Design match

Firmivra · Oct 14, 2026 · one text for developers and Claude Code sessions. Every screen you build from a design in `docs/mockups/` follows these six rules. Read them before you write code and tick the checklist at the end before you open the PR.

Use the components in `docs/ui-kit.md` first. Ask Fahad for a kit addition only when a design element is missing from the kit; until it lands, keep a small local component in your page's `_components/` folder.

## The rules

1. Before writing code, look at the design in parts (top bar, sidebar, every card, every row) by cropping and enlarging each part. List EVERY element: text, icon (shape, solid or outline), colour, tile or background colour, size, spacing, radius, shadow, font weight. Count the items in each list. Nothing may be left off.
2. Build every element. Where data or a module does not exist yet, show the element's frame with a quiet empty state; never invented numbers, never 'Coming soon' inside a widget. This also holds when the data call fails or the API is not built yet (dev has no API for several modules): the page still shows every widget's frame with its quiet empty state; one error panel never replaces a page. Check every page in three states: with data, empty, and API unreachable.
3. Icons: solid (fill) Phosphor icons already in the app; list any icon that is not exact.
4. Colours and sizes: measure from the image pixels and use tokens from `packages/ui`; add a token only when the design colour has none.
5. Render at 1440 px and compare region by region; fix every visible difference and repeat until none is visible; finish by ticking the checklist.
6. Put screenshots next to the design in the PR and list every difference you could not remove, and why.

## Checklist (copy it into the PR)

- [ ] Every part of the design was cropped and enlarged, and its elements listed and counted (rule 1)
- [ ] Every element is built; no widget was dropped (rule 2)
- [ ] Where there is no data, the widget shows its frame with a quiet empty state: no invented numbers, no "Coming soon" inside a widget (rule 2)
- [ ] The page was checked in three states (with data, empty, API unreachable) and every widget's frame shows in each (rule 2)
- [ ] Icons are solid Phosphor icons; every icon that is not exact is listed in the PR (rule 3)
- [ ] Colours and sizes were measured from the image and come from `packages/ui` tokens; a new token only where the design colour has none (rule 4)
- [ ] The page was rendered at 1440 px and compared region by region, and the fixes repeated until no difference is visible (rule 5)
- [ ] The PR shows screenshots next to the design and lists every difference that could not be removed, and why (rule 6)
- [ ] Components come from `docs/ui-kit.md`; a kit addition was requested only for a design element the kit lacks
