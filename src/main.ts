import '@logseq/libs';
import { joinMacroArgs, type Kind } from './core/dsl';
import type { AssetScheme } from './core/images';
import { buildMacro, LEGACY_TYPE, MACRO_KINDS, type MacroKind } from './core/macroText';
import { renderLegacy } from './core/view';
import { newRowFor } from './core/newRow';
import { applyControl, errorText, deleteBlocks, expandInlineBlock, insertRow, jumpTo, saveTitle, readMacro, saveCell, saveDsl, setImgInMacro, type SetEvent } from './host/actions';
import type { LogseqLike } from './host/api';
import { Engine } from './host/engine';
import { InlineViews } from './host/inline';
import { installInlineSlash } from './host/inlineSlash';
import { FIELD_SELECTOR, Interact } from './host/interact';
import inlineCss from './style/inline.css?raw';
import { CardViews } from './host/cards';
import { CardCopier } from './host/cardCopy';
import { fetchCards } from './host/cardsFetch';
import { imageToPng } from './host/clipboardImage';
import { resolveImageSrc } from './core/images';
import tokensCss from './style/tokens.css?raw';

const DEFAULT_TYPES_PAGE = 'dataquery/types';

const api = logseq as unknown as LogseqLike;
const typesPage = () => String(logseq.settings?.typesPage || DEFAULT_TYPES_PAGE);

function report(e: unknown): void {
  console.error('[dataquery]', e);
  void logseq.UI.showMsg(errorText(e), 'error');
}

/** Save a query typed into the view (already parsed by the caller). */
async function setDslFromView(uuid: string, next: string): Promise<void> {
  const { macro, kind, dsl } = await readMacro(api, uuid);
  if (next !== dsl) await saveDsl(api, uuid, macro, kind, next);
}

async function main(): Promise<void> {
  logseq.useSettingsSchema([
    {
      key: 'typesPage',
      type: 'string',
      default: DEFAULT_TYPES_PAGE,
      title: 'Types page',
      description: 'Page whose properties set column types, e.g. seed:: category or score-*:: ratio.',
    },
  ]);
  const engine = new Engine(api, typesPage);
  logseq.provideStyle(tokensCss + '\n' + inlineCss);

  // `../assets/x.png` in a table cell loads from `<graph>/assets/x.png`. Logseq's desktop app serves
  // local files through its own `assets://` protocol (as its own image blocks do); a browser uses file://.
  let graphPath: string | undefined;
  const readGraph = async () => {
    try {
      graphPath = (await logseq.App.getCurrentGraph())?.path ?? undefined;
    } catch (e) {
      console.warn('[dataquery] could not read the graph folder; asset images in tables will show as text', e);
    }
  };
  await readGraph();
  let assetScheme: AssetScheme = 'file';
  try {
    if (/Electron/i.test(parent.navigator.userAgent)) assetScheme = 'assets';
  } catch (e) {
    console.warn('[dataquery] could not read the host user agent; using file:// for images', e);
  }
  /** Columns added with the table's `+`, per macro block, until a value is written. */
  const extra = new Map<string, string[]>();
  /** Cols ▾ ticks drawn but not written yet, per macro block. */
  const drafts = new Map<string, string>();

  let interact: Interact | undefined;
  let cardViews: CardViews | undefined;
  const provide = (slot: string, html: string) => {
    logseq.provideUI({ key: `dataquery-${slot}`, slot, reset: true, template: html });
    interact?.attach(slot);
  };
  const slotEl = (slot: string): HTMLElement | null | undefined => {
    try {
      return parent.document.getElementById(slot);
    } catch (e) {
      console.warn('[dataquery] cannot inspect the Logseq window; keeping the view', e);
      return undefined;
    }
  };
  const views: InlineViews = new InlineViews(engine, provide, (slot) => slotEl(slot) !== null, {
    readDsl: async (uuid) => (await readMacro(api, uuid)).dsl,
    chartOpts: (uuid) => interact?.optsFor(uuid),
    tableOpen: (uuid) => interact?.tableOpen(uuid) ?? false,
    painted: (slot) => {
      const el = slotEl(slot);
      return el === undefined || !!el?.querySelector('.dq');
    },
    busy: (slot) => {
      const active = slotEl(slot)?.ownerDocument.activeElement;
      return !!active?.matches(FIELD_SELECTOR) && !!slotEl(slot)?.contains(active);
    },
    graphPath: () => graphPath,
    assetScheme: () => assetScheme,
    extraCols: (uuid) => extra.get(uuid) ?? [],
    draft: (uuid) => drafts.get(uuid),
    full: (uuid) => interact?.isFull(uuid) ?? false,
  });

  const leaveEditing = () => {
    // Synchronous, in Logseq's own window: the async plugin API would arrive after the focus moved.
    const host = parent as unknown as { logseq?: { api?: { exit_editing_mode?: (select: boolean) => void } } };
    const active = parent.document.activeElement;
    if (active?.matches('textarea') && active.id.startsWith('edit-block')) host.logseq?.api?.exit_editing_mode?.(false);
  };
  try {
    interact = new Interact(parent.document, {
      submit: setDslFromView,
      view: (uuid) => views.view(uuid),
      report,
      notify: (msg) => void logseq.UI.showMsg(msg, 'success'),
      resume: () => void views.resume().catch(report),
      saveCell: (block, key, value) => saveCell(api, block, key, value),
      setImg: (uuid, px) => setImgInMacro(api, uuid, px),
      addRow: async (macro) => {
        const data = views.view(macro);
        if (!data) throw new Error('The table has not finished drawing yet.');
        const made = newRowFor(data.query, data.result.rows.length + 1);
        // Right below the block of the last row on screen; an empty table starts below the macro block.
        const last = data.result.rows[data.result.rows.length - 1];
        const uuid = await insertRow(api, last ? last.sources[0].uuid : macro, made.content);
        // A block with no property of its own is no row to any query: show it until it gets one.
        views.addPending(macro, { id: uuid, title: made.title, titleOwn: true, titleBlock: uuid, values: { ...made.values }, sources: [{ uuid, pageTitle: '', journalDay: null }], conflicts: {} });
        engine.invalidate();
        await views.refreshAll();
        return uuid;
      },
      jump: (uuid) => jumpTo(api, uuid).catch(report),
      openPage: async (name) => {
        try {
          await logseq.App.pushState('page', { name });
        } catch (e) {
          throw new Error(`Could not open the page "${name}".`, { cause: e });
        }
      },
      openUrl: async (url) => {
        try {
          await logseq.App.openExternalLink(url);
        } catch (e) {
          throw new Error(`Could not open ${url}.`, { cause: e });
        }
      },
      saveTitle: (block, title) => saveTitle(api, block, title),
      deleteRow: async (macro, index) => {
        const row = views.view(macro)?.result.rows[index];
        if (!row) throw new Error('That row is no longer in the table.');
        const uuids = row.sources.map((s) => s.uuid);
        await deleteBlocks(api, uuids);
        for (const u of uuids) views.dropPending(macro, u);
        engine.invalidate();
        await views.refreshAll();
      },
      addColumn: (uuid, key) => {
        extra.set(uuid, [...(extra.get(uuid) ?? []), key]);
        void views.refreshAll().catch(report);
      },
      leaveEditing,
      dslOf: (uuid) => views.dslOf(uuid),
      preview: (uuid, dsl) => {
        if (dsl === undefined) drafts.delete(uuid);
        else drafts.set(uuid, dsl);
        void views.refreshAll().catch(report);
      },
      selectBlock: (uuid) => void logseq.Editor.selectBlock(uuid).catch((e) => report(new Error('Could not select the query block.', { cause: e }))),
      clearSelection: () => {
        // Only the highlight: keys typed in the focused table never reach Logseq (the window-capture shield).
        // `clear_selected_blocks` is not in the typed plugin API, so it is called only when present.
        const host = parent as unknown as { logseq?: { api?: { clear_selected_blocks?: () => void } } };
        host.logseq?.api?.clear_selected_blocks?.();
      },
    });
    const off = interact.install();
    const win = parent as unknown as Window & typeof globalThis;
    const clip = () => {
      const c = win.navigator.clipboard;
      if (!c) throw new Error('The clipboard is not available in this window.');
      return c;
    };
    const copier = new CardCopier(api, {
      writeText: (text) => clip().writeText(text),
      writeImage: async (src) => {
        const url = resolveImageSrc(src, graphPath, assetScheme);
        if (url === null) throw new Error(`The picture ${src} cannot be loaded.`);
        const png = await imageToPng(win, url);
        await clip().write([new win.ClipboardItem({ 'image/png': png })]);
      },
    });
    cardViews = new CardViews(parent.document, {
      fetch: (refs, uuid) => fetchCards(api, refs, uuid),
      copier,
      provide: (slot, html) => logseq.provideUI({ key: `dataquery-${slot}`, slot, reset: true, template: html }),
      exists: (slot) => slotEl(slot) !== null,
      save: setDslFromView,
      selectBlock: (uuid) => void logseq.Editor.selectBlock(uuid).catch((e) => report(new Error('Could not select the query block.', { cause: e }))),
      openUrl: (url) => void logseq.App.openExternalLink(url).catch((e) => report(new Error(`Could not open ${url}.`, { cause: e }))),
      report,
      graphPath: () => graphPath,
      assetScheme: () => assetScheme,
    });
    const offSlash = installInlineSlash(parent.document, { convert: (uuid) => expandInlineBlock(api, uuid), leaveEditing, report });
    logseq.beforeunload(async () => {
      off();
      offSlash();
      cardViews?.dispose();
    });
  } catch (e) {
    report(new Error('Data query cannot reach the Logseq window: the query field, chart tools and CSV copy will not respond.', { cause: e }));
  }

  logseq.App.onMacroRendererSlotted(async ({ slot, payload }) => {
    const [type, ...rest] = (payload.arguments ?? []) as string[];
    // `{{renderer :DQtable #tag}}` without the comma arrives as one argument.
    const name = type?.trim().split(/\s/)[0];
    if (name === LEGACY_TYPE) {
      logseq.provideUI({ key: `dataquery-${slot}`, slot, reset: true, template: renderLegacy() });
      return;
    }
    const kind: MacroKind | undefined = name ? MACRO_KINDS[name] : undefined;
    if (!kind) return;
    // Read the query from the block text: Logseq's argument splitting loses spacing inside quotes.
    let dsl: string;
    try {
      dsl = (await readMacro(api, payload.uuid)).dsl;
    } catch (e) {
      console.warn('[dataquery] could not read the macro text; using the macro arguments', e);
      dsl = joinMacroArgs([type.trim().slice(name.length), ...rest].filter((a) => a.trim()));
    }
    if (kind === 'cards') {
      if (!cardViews) return report(new Error('DQcards cannot reach the Logseq window, so it cannot draw.'));
      return cardViews.show(slot, payload.uuid, dsl);
    }
    await views.show(slot, payload.uuid, kind, dsl);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  logseq.DB.onChanged(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      engine.invalidate();
      void views.refreshAll();
      void cardViews?.refreshAll().catch(report);
    }, 300);
  });

  logseq.App.onCurrentGraphChanged(() => {
    engine.invalidate();
    views.clearPending();
    void readGraph().then(() => views.refreshAll());
  });

  logseq.onSettingsChanged(() => {
    engine.invalidate();
    void views.refreshAll();
  });

  logseq.provideModel({
    dqJump: (e: { dataset: { uuid: string } }) => jumpTo(api, e.dataset.uuid).catch(report),
    dqNoop: () => {},
    // In full screen a click on blank space does nothing: raw editing would take the view away.
    dqEdit: (e: { dataset: { macro: string } }) =>
      interact?.isFull(e.dataset.macro) ? undefined : logseq.Editor.editBlock(e.dataset.macro).catch((err) => report(new Error('Could not open the block for editing.', { cause: err }))),
    dqSet: (e: SetEvent) => applyControl(api, e).catch(report),
  });

  const kinds: Array<[string, MacroKind]> = [['DQ table', 'table'], ['DQ scatter', 'scatter'], ['DQ bar', 'bar'], ['DQ cards', 'cards']];
  for (const [label, kind] of kinds) {
    logseq.Editor.registerSlashCommand(label, async () => {
      await logseq.Editor.insertAtEditingCursor(buildMacro(kind, ''));
    });
  }
}

logseq.ready(main).catch((e) => console.error('[dataquery] failed to start', e));
