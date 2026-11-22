# Outline for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[Outline](https://www.getoutline.com), the team wiki: follow its counters and
the document changed last, react when a document is created or updated, search
it from scenes, write documents and keep a journal that Gladys fills in line by
line. Self-hosted Outline (local) or Outline Cloud (same API).

Tested against a real Outline 1.13.0 (official Docker image
`outlinewiki/outline`).

## Features

- **An Outline device**: reachable, documents, collections, and the latest
  changed document (title, author, date).
- **Dashboard widget** "Outline": two tiles and the eight documents changed
  last (of the whole wiki or of a collection), each opening in Outline over
  https.
- **Scene trigger** "Outline document created or updated" (filters: collection,
  created or updated), silent at installation, remembered across restarts.
- **Scene actions**: "Create an Outline document" (Markdown), "Add a line to an
  Outline document" (a dated journal, created at its first line in a
  collection) and "Search Outline" (the best match and the count, for the next
  actions).
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- Outline reachable from Gladys, or an Outline Cloud workspace, and an API key
  (Settings → API & Apps). A key without scopes can do everything; a read-only
  key works without the actions that write.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-outline` (or find **Outline** in the
   catalog).
2. In **Configuration**, enter the address of Outline (`192.168.1.50:3000`) and
   the API key. Save.
3. Add the **Outline** device from the **Discover** tab.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

The container reads Outline every 15 minutes by default (5 to 60) through its
RPC API (`POST /api/<method>`, `Authorization: Bearer ol_api_…`). A read is two
requests: `documents.list` sorted by `updatedAt` with `limit: 25` (its
`pagination.total` is the number of documents) and `collections.list`, plus
`installation.info` once (the version, self-hosted only). The trigger keeps the
time of the newest change seen in `/data`. The device is published with
`should_poll: false`; only changed states are sent to Gladys. Lines are added
with `documents.update` and `append: true`, which glues the text as is: the
integration adds the paragraph break. Outline webhooks are not used: they need
an address of Gladys reachable from Outline.

Outline rate limits, per address: 1000 requests a minute overall, 100 a minute
for `documents.list`, `documents.search` and `documents.update`, 25 a minute for
`documents.create`. A 429 is reported, never retried in a loop.

## Limitations

- One Outline workspace, seen with the permissions of its API key; drafts are
  not counted.
- The trigger fires at the next read, not instantly; at most ten documents per
  read (when the 25 documents read have all changed, the rest is skipped).
  Deleted, archived and moved documents are not announced.
- Nothing is ever deleted, archived or moved in Outline.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the SDK's fake Gladys and a fake Outline answering with
bodies recorded on a real Outline 1.13.0 (`test/fixtures/outline/`).

## Credits

- [Outline](https://github.com/outline/outline), by General Outline, Inc. and
  contributors (BSL 1.1): this integration only talks to its public API and
  contains none of its code.
- The cover shows the Outline logo, from the official repository
  ([`public/images/`](https://github.com/outline/outline/tree/main/public/images)).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Outline or
General Outline, Inc.

## License

Apache-2.0, see [`LICENSE`](LICENSE).
