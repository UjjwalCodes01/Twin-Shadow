# Fonts

These fonts are bundled with the game and served with it; nothing is loaded
from another site. Each is under the SIL Open Font License 1.1, and each
folder holds its licence as `OFL.txt`.

| Folder | Font | Used by | Copyright |
| --- | --- | --- | --- |
| `fraunces/` | Fraunces | Lamp and paper theme | 2020 The Fraunces Project Authors |
| `ibm-plex-mono/` | IBM Plex Mono | Blueprint theme | 2017 IBM Corp. |
| `jost/` | Jost | Night gallery theme | 2020 The Jost Project Authors |

The files are the Latin subsets at weights 400 and 700, taken unchanged from
the `@fontsource` packages (version 5.3.0), which repackage the original
releases. `src/client/theme.ts` is the only file that refers to them.
