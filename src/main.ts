import '@logseq/libs';

async function main(): Promise<void> {
  console.info('[dataquery] loaded');
}

logseq.ready(main).catch((e) => console.error('[dataquery] failed to start', e));
