---
name: brainspace-artifacts
description: Use when the user wants something to look at or click in Brainspace instead of a doc to read, such as a dashboard, a tracker, a report with charts, a small internal tool, a form over a database, or "make this an artifact". Covers writing the page, reading and updating databases from it, keeping it current with flows, and sharing it with the team.
---

# Artifacts in Brainspace

An artifact is a page Brainspace runs for the team: a pipeline dashboard, a renewals tracker, a weekly report with charts, a form for logging feedback. It is an ordinary doc whose name ends in `.html`, with one tag in its `<head>` that marks it as an artifact:

```html
<meta name="brainspace" content="artifact">
```

Open a doc with that tag in the app and the page runs, with its code one click away. An `.html` doc without the tag is a plain file (an email template, an exported page): the app shows its code and nothing runs. `list` and `read` mark artifacts with `artifact: true`.

Because it's a doc, everything you know still applies. `write` creates it, `edit` changes it, every save is a version you can `diff` and restore, it's private under `/me` until you `promote` it, and `access_set` restricts it. There are no separate artifact tools.

Make an artifact when people will look at the result more than once and it's better seen than read. For a one-off answer, reply in the conversation. For prose, write a doc.

## Where it goes

Give each artifact its own folder, with the page and the data it owns side by side:

```
/me/artifacts/pipeline/index.html
/me/artifacts/pipeline/data.db
```

The page refers to `data.db` by a relative path, so the folder keeps working when it's moved or promoted. Set a `description` on the page, and put a real `<title>` in it: that's the name people see in the Artifacts list.

`write` and `edit` return `artifact.url`. Give the user that link. They also return `artifact.warnings` when the page uses something the sandbox blocks. Fix those before you say it's done, because you can't see the page run. If the result has no `artifact` at all, the tag is missing and the page won't run.

## Data comes from databases

Don't paste rows into the HTML. Put them in a database and have the page query it, so the page stays current without being rewritten:

1. `db_create` the database next to the page, with its tables.
2. Fill it with `db_insert`, or have a flow fill it on a schedule.
3. Write the page so it reads the database when it opens.

Whoever updates the database (you, another agent, a flow, a person in the grid) updates every open copy of the page.

## The `brain` object

Every artifact has a global `brain`. Calls run as the person looking at the page, with their role.

```js
// Rows come back as objects. Values go in params, never into the SQL.
const deals = await brain.db.query('data.db', 'SELECT * FROM deals WHERE stage = ? ORDER BY amount DESC', ['open'])

await brain.db.insert('data.db', 'deals', [{ name: 'Northwind', stage: 'open', amount: 12000 }], { upsertOn: ['name'] })
await brain.db.exec('data.db', 'UPDATE deals SET stage = ? WHERE id = ?', ['won', 7])   // { changes, rows }
await brain.db.batch('data.db', [{ sql: '...', params: [] }, { sql: '...' }])            // one transaction
await brain.db.schema('data.db')                                                         // tables and columns

const doc = await brain.read('/team/brand/voice.md')   // { path, content, version, ... } for text docs
img.src = await brain.file('logo.png')                 // a blob: URL for an image or other file

brain.onChange((change) => load())    // a database or doc this page has used was changed
brain.open('/team/customers/customers.db')             // go to a place in Brainspace
brain.download('deals.csv', csvText, 'text/csv')       // hand the viewer a file
brain.user.name                                        // who is looking
brain.artifact                                         // { path, name, version }
```

Paths are relative to the artifact's folder (`data.db`, `../customers/customers.db`) or absolute (`/team/...`, `/me/...`).

`brain.db.query` runs one read-only statement and throws past 5000 rows, so filter, aggregate and page in SQL. Read-only members can open the page and run queries, but their writes fail: catch that and say so instead of leaving a dead button.

A page that loads its data in one function and passes it to `brain.onChange` stays live for free:

```html
<!doctype html>
<meta name="brainspace" content="artifact">
<title>Pipeline</title>
<!-- ...markup and styles... -->
<script>
  async function load() {
    const rows = await brain.db.query('data.db', 'SELECT stage, COUNT(*) AS n, SUM(amount) AS total FROM deals GROUP BY stage')
    // ...draw rows
  }
  load()
  brain.onChange(load)
</script>
```

## What the sandbox allows

The page runs in a sealed frame. This is what lets it show the team's data safely: nothing it reads can be sent anywhere.

- No network. `fetch`, `XMLHttpRequest`, WebSockets and form posts to other sites are blocked. Data comes from `brain`. If the page needs something from an outside API, have a flow fetch it into the database.
- Scripts and stylesheets load only from `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`, `esm.sh` and `cdn.tailwindcss.com`. Fonts also load from Google Fonts. Pin versions (`chart.js@4.4.1`).
- No remote images. Upload the image to Brainspace and use `brain.file(path)`, or inline it as SVG or a `data:` URL.
- No `localStorage`, `sessionStorage` or cookies. State that should last belongs in a database.
- Links to Brainspace paths (`<a href="data.db">`, `<a href="/team/brand/voice.md">`) open in the app. Links to other sites show the viewer the address first and open when they click it.
- No popups, no nested frames, and the page can't navigate or reload itself. To refresh, call your `load()` again.

Write the whole page in one file: inline `<style>` and `<script>`, plus libraries from the CDNs above. Plain HTML and JavaScript is the most reliable. React through `esm.sh` works too.

## Looking like Brainspace

The frame sets a base font and text color, and these CSS variables match the app: `--brain-font`, `--brain-mono`, `--brain-ink`, `--brain-ink-2`, `--brain-ink-3`, `--brain-line`, `--brain-wash`, `--brain-paper`, `--brain-sheet`, `--brain-brand`, `--brain-brand-ink`, `--brain-brand-wash`, `--brain-agent`, `--brain-ok`, `--brain-danger`. Use them for text, borders and accents unless the team's brand kit says otherwise. The app is light only. The frame is as wide as the window allows and the viewer can make it full screen, so lay out for both a laptop and a wide monitor.

Build values into the DOM with `textContent`, not by joining strings into `innerHTML`: database rows are data, and a name containing `<` shouldn't become markup.

## Keeping it current with a flow

A flow can keep an artifact fresh in two ways, and the first is nearly always right:

- Update the database. List the database under `uses.write` in `FLOW.md` and upsert rows on a schedule. The page picks the change up by itself.
- Rewrite the page. `brain.write('/team/artifacts/report/index.html', html)` saves a new version. Use this only when the page itself is the output, like a weekly report whose layout depends on what happened.

See the `brainspace-flows` skill for writing and scheduling the flow.

## Sharing

Build in `/me`, open the link, and check it with the user. Then `promote` the folder (`/me/artifacts/pipeline` to `/team/artifacts/pipeline`) so the page and its database move together. Ask before promoting.

A team artifact can only use data that everyone who can open it can also see:

- It can't read anything under `/me`. Promote the database with the page.
- It can't read a database or doc restricted to fewer people than the artifact. Put the artifact in the same restricted folder, or restrict it to the same people with `access_set`.

When a call breaks one of these rules it fails with `forbidden` and says which path is the problem.

## Checklist

1. Folder with `index.html` and its database. Relative paths in the page.
2. The artifact tag in `<head>`, a `<title>`, and a `description`.
3. Data read through `brain.db.query` with `params`, not pasted in.
4. One `load()` passed to `brain.onChange`.
5. Errors shown on the page (`catch` and write the message somewhere visible).
6. No `artifact.warnings` left in the last `write` or `edit` result.
7. The user has the `artifact.url`.
