# ReplyPlex Compose UX

A Chrome extension that reshapes the ticket detail page on
`desk.replyplex.com` — mainly to fix a composer that fought back when you
scrolled while writing a reply.

Unofficial and personal; not affiliated with or endorsed by ReplyPlex. The
icon is ReplyPlex's own mark, used so the extension is recognisable in the
extensions list.

## What it changes

### The composer scrolls once, not twice

The composer nested two scroll containers: an `overflow-y-auto` wrapper
holding the toolbar, editor and Cc/Bcc, and the editor's own scroller capped
by an inline `max-height: min(40vh, 360px)`. Once a draft grew past that cap
the wrapper started scrolling too, which carried the formatting toolbar up
and out of the card.

The wrapper is now a plain flex column with the editor as its only flexible
child, and the editor's cap is lifted. One surface scrolls; the toolbar,
Cc/Bcc row and send bar stay put.

### Cc/Bcc folds away

Cc and Bcc sit behind a disclosure in the send bar, collapsed by default,
which hands their ~44px back to the editor. The choice is remembered. It
refuses to collapse while either field holds a recipient — and marks itself
with a dot instead — so an address can never be hidden from you.

### An unopened composer stops reserving space

Before you click into it the composer is a single "Reply to …" bar, but its
container still reserved the full height you had dragged it to (340–384px
depending on the window), leaving a slab of dead space. It now shrinks to
about 72px and the thread takes the rest. Your dragged height is untouched
and comes straight back when the composer opens.

### Ticket Fields above Knowledge

In the customer panel, Ticket Fields moves up to sit directly under the
customer card, above Knowledge.

### One top bar instead of two

The page stacked a slim 48px app bar (breadcrumb, notifications, avatar,
full width) on a 65px ticket bar (title, prev/next, assignee, tags, status,
more) that spanned only the thread column.

The app bar is the one that stays — same height, same full width,
notifications and avatar still hard right. The breadcrumb goes, and the
ticket bar's title and all of its controls are laid into the empty left part
of that row. One slim full-width bar carries everything, and the thread gains
the ticket bar's 65px.

The title and its tag chips collapse onto a single line so the bar stays 48px
even on a tagged ticket; a long title truncates rather than pushing controls
out of reach.

### Docked or scrolls-with-the-ticket

A **Docked / Scrolls** switch in the send bar, remembered across sessions.

- **Docked** (default) — the composer is pinned to the bottom. Resize it with
  the app's own drag strip, which this extension also makes visible on hover.
- **Scrolls** — the composer sits at the end of the conversation and travels
  off-screen as you scroll up, like part of the thread. The ticket bar sticks
  to the top. The editor gets a native drag-to-grow grabber at its
  bottom-right corner; dragging it taller grows the whole composer.

In Scrolls mode the thread is no longer the scroll container, so the app's own
scroll-to-newest no longer applies — the extension scrolls the ticket to the
newest message instead, and stops trying the moment you scroll by hand.

Note that Scrolls mode does have two scrollbars by nature: one for the ticket
and one inside the editor. That is the point of the mode, and unlike the
original bug the toolbar never leaves.

### Smaller things

A real focus ring on the editor, larger toolbar hit targets with a clearer
hover, comfortable line height, and a slim editor scrollbar.

## Install

Chrome removed the `--load-extension` command-line switch in 137, so load it
by hand:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → pick this folder
4. Reload any open ReplyPlex tab

After editing `compose-ux.js` or `compose-ux.css`, hit **Reload** on the
extension's card and reload the tab.

## Tuning it

Everything visual lives in `compose-ux.css`. The values most worth changing:

| What | Where |
| --- | --- |
| Composer drag floor, 224px. The app allows 180px, but the tabs, toolbar and send bar leave the editor ~10px there. | `[data-rpx="composer"] { min-height }` |
| Editor's starting height in Scrolls mode, 168px | `html[data-rpx-composer="inline"] [data-rpx="editor"] { min-height }` |
| Width the top-bar merge needs, 1024px. Narrower, the ticket controls need a second row and the app's two bars are left alone. | `@media (min-width: 1024px)` in section 9 |
| Sidebar card order | `[data-rpx="sidebar-stack"] > *` and the `[data-rpx-card]` rules |

Preferences are kept in `localStorage` under `rpx.composer.mode` and
`rpx.ccbcc.open`.

## How it works

`compose-ux.js` stamps `data-rpx` attributes onto the parts of the page, and
every CSS rule is scoped to one of those attributes. Nothing outside the
ticket page is touched, and leaving the page clears the marks.

| Attribute | Element |
| --- | --- |
| `maincol`, `topbar`, `crumbs`, `topbar-actions` | app bar and its parts |
| `tickethead`, `tickethead-title`, `tickethead-actions` | ticket bar and its parts |
| `ticket-section`, `thread`, `handle` | thread column and the drag strip |
| `composer` / `composer-collapsed`, `card`, `tabs`, `wrap`, `pad`, `editorbox`, `toolbar`, `editor`, `ccbcc`, `footer` | composer |
| `sidebar`, `sidebar-stack` + `data-rpx-card` | customer panel |

Three constraints shaped the implementation:

**No app-owned node is moved.** React owns both bars and the panel cards, and
removes children through their recorded parent — reparenting one would throw
on unmount and take the page down. So the bar merge is absolute positioning
and the sidebar reorder is flex `order`.

**Every DOM write is guarded by a read**, and the observer watches `childList`
only. Our own attribute writes therefore cannot retrigger it, so re-stamping
runs synchronously inside the observer callback — a microtask, before paint —
and a React re-render never shows a frame of unstyled layout. Once the page is
settled the observer does no work at all.

**The element walk is structural, not class-based.** It anchors on the
drag-resize strip, which only exists on a ticket page, and walks from there.
The Reply and Internal note tabs render the same skeleton with different
classes on the card (`bg-card` versus an amber `bg-[#FFFBEB]`), so anchoring
on a class silently skips one of them. Where a measurement is unavoidable —
the app bar's height, the width of the notifications and avatar group — it is
read from the live element and published as a CSS variable, so a badge on the
bell cannot end up overlapping the ticket controls.

If the page's shape is not the one the walk recognises, the extension removes
its own marks and hands the page back to the app unstyled. A ReplyPlex
redesign should therefore degrade to the stock UI rather than break it.
