import '@logseq/libs';
import { joinMacroArgs } from './core/dsl';
import { MACRO_TYPE } from './core/macroText';
import { errorText, jumpTo, readMacro, saveDsl, setType } from './host/actions';
import type { LogseqLike } from './host/api';
import { Engine } from './host/engine';
import { InlineViews } from './host/inline';
import { Interact } from './host/interact';
import { mountPanel } from './panel/mount';
import inlineCss from './style/inline.css?raw';
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
  const { macro, dsl } = await readMacro(api, uuid);
  if (next !== dsl) await saveDsl(api, uuid, macro, next);
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

  let interact: Interact | undefined;
  const views: InlineViews = new InlineViews(
    engine,
    (slot, html) => {
      logseq.provideUI({ key: `dataquery-${slot}`, slot, reset: true, template: html });
      interact?.attach(slot);
    },
    (slot) => {
      try {
        return !!parent.document.getElementById(slot);
      } catch (e) {
        console.warn('[dataquery] cannot inspect the Logseq window; keeping the view', e);
        return true;
      }
    },
  );

  try {
    interact = new Interact(parent.document, { submit: setDslFromView, chart: (uuid) => views.chart(uuid), report });
    const off = interact.install();
    logseq.beforeunload(async () => off());
  } catch (e) {
    report(new Error('Data query cannot reach the Logseq window: the query field and chart tools will not respond.', { cause: e }));
  }

  logseq.App.onMacroRendererSlotted(async ({ slot, payload }) => {
    const [type, ...rest] = (payload.arguments ?? []) as string[];
    // `{{renderer :dataquery where …}}` without the comma arrives as one argument.
    if (type?.trim().split(/\s/)[0] !== MACRO_TYPE) return;
    // Read the query from the block text: Logseq's argument splitting loses spacing inside quotes.
    let dsl: string;
    try {
      dsl = (await readMacro(api, payload.uuid)).dsl;
    } catch (e) {
      console.warn('[dataquery] could not read the macro text; using the macro arguments', e);
      dsl = joinMacroArgs(rest);
    }
    await views.show(slot, payload.uuid, dsl);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  logseq.DB.onChanged(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      engine.invalidate();
      void views.refreshAll();
      panel.refresh();
    }, 300);
  });

  const closePanel = () => {
    logseq.hideMainUI();
    panel.close();
  };
  const panel = mountPanel(document.getElementById('app')!, {
    evaluate: (dsl, uuid) => engine.evaluate(dsl, uuid),
    save: (uuid, macro, dsl) => saveDsl(api, uuid, macro, dsl),
    setType: (key, type) => setType(api, typesPage(), key, type),
    jump: async (uuid) => {
      closePanel();
      await jumpTo(api, uuid);
    },
    close: () => closePanel(),
    report,
  });
  const openPanel = async (uuid: string) => {
    const { macro, dsl } = await readMacro(api, uuid);
    panel.open({ uuid, dsl, macro });
    logseq.showMainUI({ autoFocus: true });
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  const applyTheme = (mode: string) => {
    document.documentElement.dataset.theme = mode === 'dark' ? 'dark' : 'light';
  };
  applyTheme((await logseq.App.getUserConfigs()).preferredThemeMode);
  logseq.App.onThemeModeChanged(({ mode }) => applyTheme(mode));

  logseq.onSettingsChanged(() => {
    engine.invalidate();
    void views.refreshAll();
    panel.refresh();
  });

  logseq.provideModel({
    dqJump: (e: { dataset: { uuid: string } }) => jumpTo(api, e.dataset.uuid).catch(report),
    dqNoop: () => {},
    dqEdit: (e: { dataset: { macro: string } }) =>
      logseq.Editor.editBlock(e.dataset.macro).catch((err) => report(new Error('Could not open the block for editing.', { cause: err }))),
    dqOpen: (e: { dataset: { macro: string } }) => openPanel(e.dataset.macro).catch(report),
  });

  logseq.Editor.registerSlashCommand('Data query', async () => {
    await logseq.Editor.insertAtEditingCursor('{{renderer :dataquery}}');
  });
}

logseq.ready(main).catch((e) => console.error('[dataquery] failed to start', e));
