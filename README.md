<img src="icons/icon-128.png" alt="ReplyPlex" width="88">

# ReplyPlex Compose UX

A Chrome extension that cleans up the ticket page in ReplyPlex, mostly so that
writing a reply stops fighting you.

It only runs on `desk.replyplex.com`. It changes how the page looks and
behaves — it never sends anything, and it never touches your tickets or drafts.

Unofficial and personal. Not affiliated with or endorsed by ReplyPlex. The
icon is ReplyPlex's own, so the extension is easy to spot in your extensions
list.

## What it changes

### 1. Writing a reply no longer scrolls the toolbar away

**Before:** once a reply got long enough, scrolling inside the box also
scrolled the whole compose area. The Bold / Italic / link buttons slid up out
of sight and you had to scroll back to get them.

**After:** only the text scrolls. The toolbar, the Cc/Bcc row and the Send bar
stay exactly where they are, however long the reply gets.

This happened because the compose area had two scrollbars stacked inside each
other. Now it has one.

### 2. Cc and Bcc fold away

They sit behind a small **Cc/Bcc** button in the Send bar, closed by default,
which gives that space to the typing area. The extension remembers your choice.

If either field has an address in it, it stays open and shows a dot, so an
address can never be hidden from you.

### 3. No dead space before you start replying

**Before:** until you clicked into it, the composer was a one-line
"Reply to…" bar, but the page still held open the full height underneath it —
a big empty block below the conversation.

**After:** that space goes back to the conversation, and your composer height
returns the moment you click into it.

### 4. Ticket Fields moved up

In the right-hand panel, **Ticket Fields** now sits just under the customer
card, above Knowledge, so you can see it without scrolling.

### 5. One top bar instead of two

**Before:** two stacked bars. A thin one with `Inbox > xCloud Support` plus the
bell and your avatar, and a taller one under it with the ticket title and all
the ticket buttons.

**After:** one thin bar with everything on it — ticket title, previous/next,
assignee, tags, status, more, and the panel toggle, with the bell and avatar
still on the far right. The breadcrumb is gone.

Every button from the old second bar is still there. The conversation gets
that whole second bar's height back.

### 6. Two ways the composer can behave

There's a **Docked / Scrolls** button in the Send bar. Your choice is
remembered.

**Docked** — the composer is fixed to the bottom of the screen, always in
view. Drag the thin strip above it to make it taller or shorter. (The
extension makes that strip visible when you hover it, which it wasn't before.)

**Scrolls** — the composer sits at the end of the conversation and scrolls
away with it, like part of the thread. Useful when you want the whole screen
for reading.

In Scrolls mode the typing box also grows by itself as you write, and it grows
**upward** — the bottom stays put so the Send button never slides off the
screen. Once the composer fills the window it stops growing and the text
scrolls inside it instead, so the toolbar and the Send bar are both always
reachable. You can also drag the bottom-right corner of the typing box to
resize it yourself.

If you've scrolled up to read something while a reply is half-written, a
growing draft won't drag you back down.

### Smaller touches

- The typing box shows a clear outline when it's focused.
- Toolbar buttons are easier to hit and highlight properly on hover.
- Roomier line spacing and a slimmer scrollbar in the typing box.

## Installing

Chrome no longer allows loading an extension from the command line, so add it
by hand:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder
4. Reload any ReplyPlex tab you have open

After changing any file here, click **Reload** on the extension's card, then
reload the tab.

## Things you can adjust

All the visual values live in `compose-ux.css`. The ones most worth changing:

| What | Where to look |
| --- | --- |
| Smallest the docked composer can be dragged, currently 224px. ReplyPlex allows 180px, but at that size the typing box is only a few pixels tall. | `[data-rpx="composer"] { min-height }` |
| How tall the typing box starts in Scrolls mode, currently 168px | `html[data-rpx-composer="inline"] [data-rpx="editor"] { min-height }` |
| How far it can grow in Scrolls mode before the text scrolls inside it | `html[data-rpx-composer="inline"] [data-rpx="editor"] { max-height }` |
| Screen width needed for the single top bar, currently 1024px. On narrower screens the ticket buttons need two rows, so ReplyPlex's own layout is left alone. | `@media (min-width: 1024px)` |
| Order of the cards in the right-hand panel | `[data-rpx="sidebar-stack"]` rules |

Your two preferences (composer mode, Cc/Bcc open or closed) are stored in the
browser under `rpx.composer.mode` and `rpx.ccbcc.open`.

## How it avoids breaking ReplyPlex

Worth knowing if you ever need to change it.

ReplyPlex is a React app, which means it owns the page and rebuilds parts of
it constantly. So the extension never moves any of ReplyPlex's elements —
moving one would crash the page when React later tried to remove it. Instead
it labels elements and restyles them in place, and does the top-bar merge and
the sidebar reorder purely with CSS positioning and ordering.

It also re-applies its labels the instant React rebuilds something, so you
never see the old layout flash, and it does no work at all once the page is
sitting still.

It finds elements by their position in the page structure rather than by
ReplyPlex's own class names, because the Reply and Internal note tabs use
different classes for the same box. If a future ReplyPlex update changes the
page enough that the extension doesn't recognise it, it removes its own
styling and leaves you with the normal ReplyPlex interface rather than a
broken one.
