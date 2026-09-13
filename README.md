# Dexcalidraw

V1 of Dexcalidraw, a presentation tool built natively on Excalidraw. Every slide is an Excalidraw canvas, so you draw and present in the same place instead of exporting images into another deck tool. Local video overlays, speaker notes, and a presenter mode with ink and a laser pointer are there if you want them. Like Google Slides but more interactive!

## Quick Start

```sh
npm install
npm run dev
```

Useful commands:

```sh
npm run build
npm run lint
npm run test:unit
npm run test
```

## Features

- Draw on a real Excalidraw canvas as a slide and organize multiple presentations with reusable templates.
- Build a slide up in reveal steps instead of duplicating it: group shapes so they appear one press at a time while presenting.
- Insert Mermaid diagrams (flowcharts, sequence, class, ER, state) as native, editable Excalidraw shapes, or import an existing `.excalidraw` file frame-by-frame.
- Install `.excalidrawlib` icon packs that persist across sessions.
- Add local video files as draggable, resizable overlays, with a compact trim/breakpoint transport for previewing clips in the editor.
- Write or draw speaker notes per slide, viewable in a separate window that flags itself if it gets disconnected mid-presentation.
- Present full-screen with keyboard navigation, presenter ink with undo, a highlighter, and a laser pointer.
- Export and import portable `.zip` deck bundles.
- Deleting a presentation moves it to the trash instead of erasing it immediately. Undo from the toast, or restore it from the Trash panel within 30 days.

## Basic Workflow

1. Draw on the canvas and add slides from the sidebar. Attach video clips or notes to a slide if you need them.
2. To build a slide up piece by piece instead of duplicating it, select the shapes for one beat and hit **Add step from selection** in the **Reveal** panel (or press `/` and run `reveal`). Each step then appears on its own `→` press while presenting.
3. Need a diagram from text instead of drawing it? Press `/` and run `mermaid`, paste the source, and it lands as regular editable Excalidraw shapes.
4. Click **Present** to go full-screen and use the keyboard shortcuts below.
5. Export a `.zip` bundle from the top bar before anything important, and import it later to restore.

## Presentation Controls

| Key | Action |
| --- | --- |
| `→` / `Space` | Next reveal step; on the last step, next slide |
| `←` | Previous reveal step; at the start of a slide, back to the previous slide fully revealed |
| `/` | Open command bar |
| `G` | Open slide overview (thumbnail grid; click a slide to jump) |
| `P` | Toggle presenter ink (pen on/off) |
| `H` | Toggle highlighter (wide translucent ink) |
| `Z` | Laser pointer |
| `C` | Clear ink on current slide |
| `Ctrl+Z` / `⌘Z` | Undo last ink stroke |
| `R` | Restart videos on current slide |
| `V` | Resume the first paused breakpoint video |
| `J` | Rewind first video 5 s |
| `K` | Play / pause first video |
| `L` | Forward first video 5 s |
| `N` | Open speaker-notes window |
| `Escape` | Exit ink mode, then exit presentation |

### Command Bar

Press `/` to open a compact command bar. Type a command and press `Enter` (or click a suggestion). `Escape` closes without changing state. `Tab` completes the selected suggestion; arrow keys navigate. What's available depends on where you are: the editor has its own small set, presentation mode has the presenter set below.

Editor commands:

| Command | Effect |
| --- | --- |
| `mermaid` | Open the Insert Mermaid dialog (`Ctrl`/`⌘`+`Enter` inserts, `Escape` cancels) |
| `reveal` | Turn the current canvas selection into a new reveal step |

Presentation commands:

| Command | Effect |
| --- | --- |
| `pen` | Enter pen mode with the last-used color and width |
| `pen red` | Enter pen mode with the named color (`red`, `orange`, `yellow`, `green`, `blue`, `white`) |
| `pen blue 4` | Enter pen mode with a color and stroke width (`1`, `2`, or `4`) |
| `highlight` | Enter highlighter mode (wide translucent strokes); takes the same color and width arguments as `pen` (e.g. `highlight yellow`) |
| `laser` | Enter laser pointer mode |
| `goto` | Open the slide overview grid |
| `goto [n]` | Jump directly to slide number `n` (out-of-range numbers land on the last slide) |
| `clear` | Clear ink on the current slide |
| `undo` | Undo the last ink stroke |
| `off` | Exit pen, highlighter, and laser modes |

Arrow keys work even while ink mode is active, so you can draw and advance slides without toggling the pen off.

## Storage

No backend, accounts, or cloud sync yet. Presentations and drawings save to `localStorage`; videos live in IndexedDB as raw Blobs so large clips don't blow up memory. Everything is tied to the current browser profile, so export `.zip` backups regularly, especially since incognito windows can wipe storage on close. A storage indicator in the top bar warns past 80% full (red past 95%), though it's not supported in every browser (Safari). Deleted presentations sit in a 30-day trash before they are freed.

## Status

This is v1: local-only, browser storage, no accounts. A backend and hosted deployment are planned next.

## License

MIT. See [LICENSE](LICENSE).
