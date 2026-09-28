# Manual checks (Logseq OG desktop)

Build: `npm install && npm run build`. Logseq → Settings → Advanced → Developer mode ON → `t p` (Plugins) → Load unpacked plugin → select this repo folder. After a rebuild, press Reload on the plugin card.

## M1 inline view
- [ ] Under a heading block, add a child `/Data query`. A table of the sibling property blocks appears.
- [ ] Edit it to `{{renderer :dataquery, where type = run | sort gre-thin | plot scatter x=gre-thin y=gre-thick color=seed}}` — chart and sorted table render; numbers sort numerically.
- [ ] `where combine in (none, mean)` works (comma inside the macro).
- [ ] `in [[work/nsb]] | where type = run | merge by run` works (link inside the macro); duplicated runs appear once, conflicts show ⚠.
- [ ] Add a `dataquery/types` page with `gre-*:: ratio` and `seed:: category` as page properties; the 1.00 line and green/red cells appear.
- [ ] Click a table link and a chart point → Logseq scrolls to the block.
- [ ] Hide labels / Show labels rewrites the macro with/without `labels=off`.
- [ ] Type `where gre-thin <` → red box with caret and message.
- [ ] Edit a run value → view updates within a second.
- [ ] Toggle light/dark theme → view stays readable.
- [ ] (Alias probe) add `:macros {"dataquery" "{{renderer :dataquery, $1}}"}` to config.edn and try `{{dataquery sort gre-thin}}`. Report whether it renders; the README documents it only if it does.
