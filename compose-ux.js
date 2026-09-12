/* ==========================================================================
   ReplyPlex Compose UX
   --------------------------------------------------------------------------
   Stamps `data-rpx` attributes onto the ticket page so compose-ux.css can
   restyle it, and adds two controls of its own: a Cc/Bcc disclosure and a
   docked / scrolls-with-ticket switch for the composer.

   Read-only with respect to the app's own state: it moves no app-owned DOM
   node, never dispatches input or click events on app controls, never binds a
   send shortcut, and clears its own marks if the page is not the one it
   recognises.

   Two properties keep it cheap and flicker-free:

   - Every DOM write is guarded by a read, so re-stamping is a no-op once the
     page has settled.
   - The observer watches childList only. Our own attribute writes therefore
     cannot retrigger it, and re-stamping runs synchronously in the callback
     -- a microtask, before paint -- so a React re-render never shows the
     unstyled layout.

   Reordering the sidebar and merging the two top bars are done with CSS
   `order` and absolute positioning rather than by moving nodes: React owns
   those elements and would throw on unmount if we reparented them.
   ========================================================================== */

(() => {
  'use strict';

  const TAG = 'data-rpx';
  const CC_ATTR = 'data-rpx-cc';
  const CARD_ATTR = 'data-rpx-card';
  const PAGE_ATTR = 'data-rpx-page';
  const MODE_ATTR = 'data-rpx-composer';

  const CC_TOGGLE = 'rpx-cc-toggle';
  const MODE_TOGGLE = 'rpx-mode-toggle';

  const CC_PREF = 'rpx.ccbcc.open';
  const MODE_PREF = 'rpx.composer.mode';

  const DOCKED = 'docked';
  const INLINE = 'inline';

  const root = document.documentElement;

  /* ---------------------------------------------------------------- helpers */

  /** Writes only on change, so re-stamping produces no mutation records. */
  const setAttr = (el, name, value) => {
    if (el && el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  };

  const dropAttr = (el, name) => {
    if (el && el.hasAttribute(name)) {
      el.removeAttribute(name);
    }
  };

  const setTag = (el, value) => setAttr(el, TAG, value);

  const setVar = (name, value) => {
    if (root.style.getPropertyValue(name) !== value) {
      root.style.setProperty(name, value);
    }
  };

  const readStore = (key, fallback) => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  };

  const writeStore = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch { /* private mode / blocked storage -- the choice stays per-page */ }
  };

  const readMode = () => (readStore(MODE_PREF, DOCKED) === INLINE ? INLINE : DOCKED);

  /* ------------------------------------------------------ layout resolution */

  /**
   * The drag-to-resize strip exists only on a ticket detail page, which makes
   * it a reliable anchor for the whole layout. Everything else is reached by
   * walking from it, so no styling hook depends on a Tailwind class that a
   * redesign could rename.
   */
  const resolveLayout = () => {
    const handle = document.querySelector('[class*="cursor-row-resize"]');
    const section = handle?.parentElement;
    const row = section?.parentElement;
    const maincol = row?.parentElement;
    if (!handle || !section || !row || !maincol) {
      return null;
    }

    const kids = (el) => [...el.children];

    const topbar = kids(maincol).find((el) => el.tagName === 'HEADER');
    const tickethead = kids(section).find((el) => el.tagName === 'HEADER');
    const thread = kids(section).find((el) => /overflow-y-auto/.test(el.className || ''));
    const sidebar = kids(row).find((el) => el.tagName === 'ASIDE');
    if (!topbar || !tickethead || !thread) {
      return null;
    }

    const crumbs = kids(topbar).find(
      (el) => el.tagName === 'DIV' && !/ml-auto/.test(el.className || ''),
    );
    const topActions = kids(topbar).find((el) => /ml-auto/.test(el.className || ''));
    const theadActions = kids(tickethead).find((el) => /justify-end/.test(el.className || ''));
    const theadTitle = kids(tickethead).find((el) => el.tagName === 'DIV' && /flex-1/.test(el.className || ''));

    const fieldsCard = sidebar
      ? [...sidebar.querySelectorAll('div')].find(
          (el) => /rounded-lg/.test(el.className || '')
            && (el.innerText || '').trim().startsWith('TICKET FIELDS'),
        )
      : null;
    const stack = fieldsCard?.parentElement;

    return {
      handle, section, row, maincol, topbar, tickethead, thread, sidebar,
      crumbs, topActions, theadActions, theadTitle,
      stack: stack && stack.children.length > 2 ? stack : null,
      fieldsCard,
    };
  };

  /* ---------------------------------------------------- composer resolution */

  /**
   * Walks up from the editor to the composer's parts.
   *
   * The walk is structural rather than class-based on purpose: the Reply and
   * Internal note tabs render the same skeleton but different classes on the
   * card (`bg-card` vs an amber `bg-[#FFFBEB]`), so anchoring on a class
   * silently skips one of the two modes.
   */
  const resolveComposer = () => {
    const editor = document.querySelector('[contenteditable="true"][data-placeholder]');
    if (!editor) {
      return null;
    }

    const editorBox = editor.parentElement;
    const pad = editorBox?.parentElement;
    const wrap = pad?.parentElement;
    const card = wrap?.parentElement;
    const composerRoot = card?.parentElement;
    if (!editorBox || !pad || !wrap || !card || !composerRoot) {
      return null;
    }

    const handle = composerRoot.previousElementSibling;
    if (!handle || !/cursor-row-resize/.test(handle.className || '')) {
      return null;
    }

    const parts = [...card.children];
    if (parts.length < 2) {
      return null;
    }

    const tabs = parts[0].contains(editor) ? null : parts[0];
    const footer = [...parts].reverse().find((el) => !el.contains(editor));
    const toolbar = editorBox.firstElementChild;
    if (!tabs || !footer || footer === tabs || !toolbar || toolbar === editor) {
      return null;
    }

    const ccbcc = [...wrap.children].find(
      (el) => el !== pad && el.querySelector('input[placeholder="Cc"], input[placeholder="Bcc"]'),
    );

    return {
      editor, editorBox, pad, wrap, card, root: composerRoot, handle,
      tabs, footer, toolbar, ccbcc,
    };
  };

  /* ---------------------------------------------------------- our controls */

  const makeButton = (className, label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
  };

  /**
   * Keeps `button` immediately after `anchor`, or first in `parent` when there
   * is no anchor. Re-asserted on every pass: switching to the Internal note
   * tab and back re-renders the bar around our buttons and would otherwise
   * leave them stranded at the front.
   */
  const placeAfter = (parent, button, anchor) => {
    if (anchor) {
      if (button.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement('afterend', button);
      }
    } else if (parent.firstElementChild !== button) {
      parent.insertBefore(button, parent.firstElementChild);
    }
  };

  const findAttachButton = (footer) =>
    [...footer.children].find(
      (el) => el.tagName === 'BUTTON'
        && !el.classList.contains(CC_TOGGLE)
        && !el.classList.contains(MODE_TOGGLE)
        && /attach/i.test(el.textContent || ''),
    );

  /** True when Cc or Bcc holds an address or a recipient chip. */
  const ccHasRecipients = (ccbcc) =>
    [...ccbcc.querySelectorAll('input')].some((input) => input.value.trim() !== '')
    || ccbcc.textContent.trim() !== '';

  const syncCcBcc = (composer) => {
    const { card, ccbcc, footer } = composer;

    // The Internal note tab has no Cc/Bcc at all, so neither should the bar.
    if (!ccbcc) {
      dropAttr(card, CC_ATTR);
      footer.querySelector('.' + CC_TOGGLE)?.remove();
      return null;
    }

    const filled = ccHasRecipients(ccbcc);
    const open = filled || readStore(CC_PREF, '0') === '1';

    setAttr(card, CC_ATTR, open ? 'open' : 'collapsed');

    let toggle = footer.querySelector('.' + CC_TOGGLE);
    if (!toggle) {
      toggle = makeButton(CC_TOGGLE, 'Cc/Bcc');
      toggle.addEventListener('click', onCcClick);
    }
    placeAfter(footer, toggle, findAttachButton(footer));

    setAttr(toggle, 'data-state', open ? 'on' : 'off');
    setAttr(toggle, 'data-filled', filled ? '1' : '0');
    setAttr(toggle, 'aria-pressed', String(open));
    setAttr(
      toggle,
      'title',
      filled
        ? 'Cc/Bcc is in use — clear the recipients to hide it'
        : open
          ? 'Hide Cc and Bcc'
          : 'Add Cc or Bcc',
    );

    return toggle;
  };

  function onCcClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const composer = resolveComposer();
    if (!composer || !composer.ccbcc) {
      return;
    }

    // Never collapse a row that is carrying recipients out of sight.
    if (ccHasRecipients(composer.ccbcc)) {
      syncCcBcc(composer);
      return;
    }

    const wasOpen = composer.card.getAttribute(CC_ATTR) === 'open';
    writeStore(CC_PREF, wasOpen ? '0' : '1');
    syncCcBcc(composer);

    if (!wasOpen) {
      composer.ccbcc.querySelector('input')?.focus();
    }
  }

  const syncModeToggle = (composer, ccToggle) => {
    const { footer } = composer;
    const docked = readMode() === DOCKED;

    let toggle = footer.querySelector('.' + MODE_TOGGLE);
    if (!toggle) {
      toggle = makeButton(MODE_TOGGLE, 'Docked');
      toggle.addEventListener('click', onModeClick);
    }
    placeAfter(footer, toggle, ccToggle || findAttachButton(footer));

    const label = docked ? 'Docked' : 'Scrolls';
    if (toggle.textContent !== label) {
      toggle.textContent = label;
    }
    setAttr(toggle, 'data-state', docked ? 'docked' : 'inline');
    setAttr(toggle, 'aria-pressed', String(!docked));
    setAttr(
      toggle,
      'title',
      docked
        ? 'Composer is docked to the bottom — click to let it scroll with the ticket'
        : 'Composer scrolls with the ticket — click to dock it to the bottom',
    );
  };

  function onModeClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const next = readMode() === DOCKED ? INLINE : DOCKED;
    writeStore(MODE_PREF, next);
    setAttr(root, MODE_ATTR, next);
    lastComposerHeight = 0;
    apply();

    if (next === INLINE) {
      snapToBottom(true);
    }
  }

  /* -------------------------------------------------- inline-mode scrolling */

  /**
   * In docked mode the app scrolls the thread to the newest message itself. In
   * scroll mode the thread is no longer the scroll container -- the section is
   * -- so the app's scroll-to-bottom lands nowhere and a ticket would open at
   * its oldest message. Nudge the section instead, a few times while embedded
   * email iframes settle and the height keeps growing, and give up the moment
   * the reader scrolls by hand.
   */
  let snapTimers = [];
  let userScrolled = false;
  let programmaticScroll = false;

  const snapToBottom = (force) => {
    if (readMode() !== INLINE) {
      return;
    }
    if (force) {
      userScrolled = false;
    }
    snapTimers.forEach(clearTimeout);
    snapTimers = [150, 450, 900].map((delay) => setTimeout(() => {
      if (userScrolled) {
        return;
      }
      const section = document.querySelector('[' + TAG + '="ticket-section"]');
      if (!section) {
        return;
      }
      programmaticScroll = true;
      section.scrollTop = section.scrollHeight;
      requestAnimationFrame(() => { programmaticScroll = false; });
    }, delay));
  };

  ['wheel', 'touchstart', 'keydown'].forEach((type) => {
    document.addEventListener(type, () => {
      if (!programmaticScroll) {
        userScrolled = true;
      }
    }, { capture: true, passive: true });
  });

  /* ----------------------------------------------- growing the composer up */

  /**
   * The editor has no fixed height in scroll mode, so a growing draft makes it
   * taller. Being the last thing in the scroll container, that growth lands
   * below the fold and takes the send bar with it -- you had to scroll down to
   * reach Send after every few lines.
   *
   * Adding the same delta to the scroll position keeps the composer's bottom
   * edge where it was, so the box appears to grow upward into the thread and
   * the send bar never leaves. Only done while the caret is in the composer or
   * the view was already sitting at the bottom, so it cannot yank someone who
   * has deliberately scrolled up to read.
   */
  let lastComposerHeight = 0;

  const growthObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        const composer = document.querySelector('[' + TAG + '="composer"]');
        const section = document.querySelector('[' + TAG + '="ticket-section"]');
        if (readMode() !== INLINE || !composer || !section) {
          lastComposerHeight = 0;
          return;
        }

        const height = composer.getBoundingClientRect().height;
        const previous = lastComposerHeight;
        lastComposerHeight = height;

        const delta = height - previous;
        // `previous` of 0 is the first measurement, not growth
        if (!previous || delta <= 0) {
          return;
        }

        const room = section.scrollHeight - section.clientHeight - section.scrollTop;
        const wasAtBottom = room <= delta + 24;
        if (!composer.contains(document.activeElement) && !wasAtBottom) {
          return;
        }

        programmaticScroll = true;
        section.scrollTop += delta;
        requestAnimationFrame(() => { programmaticScroll = false; });
      })
    : null;

  let observedComposer = null;

  const watchGrowth = (composerRoot) => {
    if (!growthObserver || observedComposer === composerRoot) {
      return;
    }
    if (observedComposer) {
      growthObserver.unobserve(observedComposer);
    }
    observedComposer = composerRoot || null;
    lastComposerHeight = 0;
    if (observedComposer) {
      growthObserver.observe(observedComposer);
    }
  };

  /* ------------------------------------------------------- measured lengths */

  // The top-bar overlay sits to the left of the customer panel, and that panel
  // can be hidden, so its width has to be measured rather than assumed.
  const measure = (layout) => {
    // The ticket bar is laid into the app bar's row, so it needs that row's
    // height and must stop short of the notifications/avatar group -- whose
    // width is measured rather than assumed, since a badge on the bell or a
    // longer avatar would otherwise end up overlapping the ticket controls.
    const barHeight = Math.round(layout.topbar.getBoundingClientRect().height);
    const actionsWidth = layout.topActions
      ? Math.round(layout.topActions.getBoundingClientRect().width)
      : 0;
    setVar('--rpx-topbar-h', (barHeight || 48) + 'px');
    setVar('--rpx-topbar-actions-w', (actionsWidth || 72) + 'px');
  };

  let observedSidebar = null;
  let observedHead = null;
  let observedTopbar = null;
  let observedActions = null;
  const sizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        const layout = resolveLayout();
        if (layout) {
          measure(layout);
        }
      })
    : null;

  const watchSizes = (layout) => {
    if (!sizeObserver) {
      return;
    }
    if (observedSidebar !== layout.sidebar) {
      if (observedSidebar) {
        sizeObserver.unobserve(observedSidebar);
      }
      observedSidebar = layout.sidebar || null;
      if (observedSidebar) {
        sizeObserver.observe(observedSidebar);
      }
    }
    if (observedHead !== layout.tickethead) {
      if (observedHead) {
        sizeObserver.unobserve(observedHead);
      }
      observedHead = layout.tickethead;
      sizeObserver.observe(observedHead);
    }
    if (observedTopbar !== layout.topbar) {
      if (observedTopbar) {
        sizeObserver.unobserve(observedTopbar);
      }
      observedTopbar = layout.topbar;
      sizeObserver.observe(observedTopbar);
    }
    if (observedActions !== layout.topActions) {
      if (observedActions) {
        sizeObserver.unobserve(observedActions);
      }
      observedActions = layout.topActions || null;
      if (observedActions) {
        sizeObserver.observe(observedActions);
      }
    }
  };

  /* ----------------------------------------------------------------- apply */

  /** Hands the matched elements back to the app's own styling. */
  const clearTags = (selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.removeAttribute(TAG);
      el.removeAttribute(CC_ATTR);
      el.removeAttribute(CARD_ATTR);
    });
  };

  const dropOurButtons = () => {
    document.querySelector('.' + CC_TOGGLE)?.remove();
    document.querySelector('.' + MODE_TOGGLE)?.remove();
  };

  const resetAll = () => {
    clearTags('[' + TAG + '], [' + CC_ATTR + '], [' + CARD_ATTR + ']');
    dropOurButtons();
    dropAttr(root, PAGE_ATTR);
  };

  /**
   * Before it is first clicked the composer is a single "Reply to ..." bar,
   * but its container still reserves the full dragged height, leaving a slab
   * of dead space under it. Marking that state lets the CSS collapse the
   * container to its content and hand the room back to the thread.
   */
  const tagCollapsedComposer = (layout) => {
    const composerRoot = layout.handle.nextElementSibling;
    if (composerRoot && !composerRoot.querySelector('[contenteditable]')) {
      setTag(composerRoot, 'composer-collapsed');
    }
  };

  const tagSidebar = (layout) => {
    if (!layout.stack) {
      return;
    }
    setTag(layout.stack, 'sidebar-stack');
    // The first card keeps its place, Ticket Fields is pulled up to second and
    // the rest follow in their own order -- all via flex `order`, so no node
    // is reparented.
    setAttr(layout.stack.firstElementChild, CARD_ATTR, 'first');
    if (layout.fieldsCard && layout.fieldsCard !== layout.stack.firstElementChild) {
      setAttr(layout.fieldsCard, CARD_ATTR, 'fields');
    }
  };

  let applying = false;

  const apply = () => {
    if (applying) {
      return;
    }
    applying = true;
    try {
      const layout = resolveLayout();
      if (!layout) {
        resetAll();
        return;
      }

      setAttr(root, PAGE_ATTR, 'ticket');
      setAttr(root, MODE_ATTR, readMode());

      setTag(layout.maincol, 'maincol');
      setTag(layout.topbar, 'topbar');
      setTag(layout.tickethead, 'tickethead');
      setTag(layout.section, 'ticket-section');
      setTag(layout.thread, 'thread');
      setTag(layout.handle, 'handle');
      if (layout.crumbs) {
        setTag(layout.crumbs, 'crumbs');
      }
      if (layout.topActions) {
        setTag(layout.topActions, 'topbar-actions');
      }
      if (layout.theadActions) {
        setTag(layout.theadActions, 'tickethead-actions');
      }
      if (layout.theadTitle) {
        setTag(layout.theadTitle, 'tickethead-title');
      }
      if (layout.sidebar) {
        setTag(layout.sidebar, 'sidebar');
      }
      tagSidebar(layout);
      measure(layout);
      watchSizes(layout);

      const composer = resolveComposer();
      if (!composer) {
        clearTags('[' + TAG + '="composer"], [' + CC_ATTR + ']');
        dropOurButtons();
        watchGrowth(null);
        tagCollapsedComposer(layout);
        return;
      }

      clearTags('[' + TAG + '="composer-collapsed"]');
      setTag(composer.root, 'composer');
      setTag(composer.card, 'card');
      setTag(composer.tabs, 'tabs');
      setTag(composer.wrap, 'wrap');
      setTag(composer.pad, 'pad');
      setTag(composer.editorBox, 'editorbox');
      setTag(composer.toolbar, 'toolbar');
      setTag(composer.editor, 'editor');
      setTag(composer.footer, 'footer');
      if (composer.ccbcc) {
        setTag(composer.ccbcc, 'ccbcc');
      }
      watchGrowth(composer.root);

      syncModeToggle(composer, syncCcBcc(composer));
    } catch {
      /* a re-render mid-walk just means we retry on the next mutation */
    } finally {
      applying = false;
    }
  };

  /* ------------------------------------------------------ react to renders */

  new MutationObserver(apply).observe(root, { childList: true, subtree: true });

  // Typing into Cc/Bcc has to keep the disclosure dot honest.
  document.addEventListener('input', (event) => {
    if (event.target?.matches?.('input[placeholder="Cc"], input[placeholder="Bcc"]')) {
      apply();
    }
  }, { capture: true, passive: true });

  // Opening a different ticket should land on the newest message again.
  let lastPath = location.pathname;
  const onPathChange = () => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      apply();
      snapToBottom(true);
    }
  };
  window.addEventListener('popstate', onPathChange);
  setInterval(onPathChange, 400);

  document.addEventListener('DOMContentLoaded', () => {
    apply();
    snapToBottom(true);
  });

  apply();
  snapToBottom(true);
})();
