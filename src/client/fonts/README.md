# Fonts

The game's one font is bundled with it and served with it; nothing is loaded
from another site. It is under the SIL Open Font License 1.1, and its folder
holds the licence as `OFL.txt`.

| Folder | Font | Copyright |
| --- | --- | --- |
| `fraunces/` | Fraunces | 2020 The Fraunces Project Authors |

The files are the Latin subsets at weights 400 and 700, taken unchanged from
the `@fontsource/fraunces` package (version 5.3.0), which repackages the
original release. `src/client/theme.ts` is the only file that refers to them.
