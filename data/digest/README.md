# Weekly digest issues

One set of files per ISO week, written by `npm run digest` (see
`docs/weekly-digest.md`):

| File | Written by | Holds |
|---|---|---|
| `<week>.json` | the weekly Routine | the AI-written summary, each sentence with the articles it cites |
| `<week>.issue.json` | mode `test` | the frozen issue: subject, HTML, text, sha256 |
| `<week>.approved.json` | mode `approve` | the approved hash and time |
| `<week>.sent.json` | mode `send` | when it went out, and to how many — never to whom |

No email address is ever written here. The repository is public.
