# Practical shared-browser workflows

The most useful cliweb workflow keeps Codex, the development shell, and a real browser in one tmux
window. Codex handles repeatable browser mechanics; the human retains visual control and handles
trust-sensitive steps.

| Task | Codex is good at | Human is good at |
| --- | --- | --- |
| Jupyter | opening notebooks, locating controls, rerunning checks, capturing state | editing nuanced cells, judging plots, interrupting kernels |
| Local HTML | reloading, traversing the DOM, taking screenshots, checking links | visual polish and interaction feel |
| Browsing | following sources, extracting structure, keeping a trail | deciding relevance and handling authentication |
| Forms | filling known values and validating required fields | credentials, sensitive data, final submission |
| UI debugging | reproducing steps and recording before/after state | spotting subtle rendering and usability problems |

## JupyterLab beside Codex

Start Jupyter without opening a desktop browser:

```bash
jupyter lab --no-browser --ip=127.0.0.1 --port=8888
```

Use the exact local URL printed by Jupyter, including its token when authentication is enabled:

```bash
cliwebctl tmux ensure 'http://127.0.0.1:8888/lab?token=...'
```

The result is a normal JupyterLab UI in the right pane. A productive division of work is:

1. Codex edits source files, notebook generators, tests, or data from the shell.
2. Codex uses `snapshot` to locate the notebook tree, tabs, buttons, and visible controls.
3. Codex uses typed actions to open a notebook, operate menus, or trigger a known command.
4. The human clicks into the same pane for detailed cell editing, plot inspection, or kernel
   decisions.
5. Codex inspects the new page state or takes a screenshot before continuing.

Example control loop:

```bash
cliwebctl --pane %N status
cliwebctl --pane %N snapshot --pretty
cliwebctl --pane %N click --ref REF
cliwebctl --pane %N wait
cliwebctl --pane %N screenshot --output /tmp/notebook.png
```

A token in the URL is visible to the same local user and appears in browser status. Use this only in
a trusted local session; enter credentials manually when they should not pass through the control
path.

## Local HTML and development servers

For a static directory:

```bash
python -m http.server 8000 --bind 127.0.0.1
cliwebctl tmux ensure http://127.0.0.1:8000
```

For Vite or another live development server:

```bash
npm run dev -- --host 127.0.0.1
cliwebctl tmux ensure http://127.0.0.1:5173
```

For a single local file:

```bash
cliwebctl tmux ensure 'file:///absolute/path/to/page.html'
```

After a code change, Codex can reload and verify the live result:

```bash
cliwebctl --pane %N reload
cliwebctl --pane %N wait
cliwebctl --pane %N snapshot --pretty
cliwebctl --pane %N screenshot --output /tmp/page-after.png
```

The human can simultaneously test hover states, drag interactions, visual rhythm, and other details
that are easier to judge directly.

## Browsing and research

Open a known source directly when possible:

```bash
cliwebctl tmux ensure 'https://developer.mozilla.org/'
cliwebctl --pane %N snapshot --pretty
```

Codex can follow semantic link refs, search within a site through its UI, and keep the browser on the
source being discussed. If a page requires login or presents a challenge, take over in the pane and
then ask Codex to inspect the resulting page.

The persistent profile preserves ordinary cookies and web storage between restarts. Use
`cliweb --private` when the browsing session should be temporary.

## Form completion with human review

Open the form and inspect its controls:

```bash
cliwebctl tmux ensure 'https://example.com/form'
cliwebctl --pane %N snapshot --pretty
```

Fill fields by semantic ref:

```bash
cliwebctl --pane %N fill --ref NAME_REF --text 'Ada Lovelace'
cliwebctl --pane %N fill --ref EMAIL_REF --text 'ada@example.com'
```

Then hand control to the human for:

- passwords, payment details, or other secrets;
- CAPTCHA and browser-native authentication;
- reviewing the exact values and destination; and
- the final submit action when it creates an external effect.

After submission, Codex can take a new snapshot and verify the confirmation page. Because refs are
document-scoped, never reuse pre-submission refs on the next page.

## UI reproduction and debugging

Use one pane for logs/tests and one for the actual rendered app:

```bash
cliwebctl tmux ensure http://127.0.0.1:3000
cliwebctl --pane %N status
cliwebctl --pane %N screenshot --output /tmp/before.png
```

Ask Codex to reproduce a sequence using semantic refs. Make the code change in the shell, reload the
same browser instance, and capture `/tmp/after.png`. This preserves the session, route, cookies, and
form state that matter to the bug.

The toolbar can be captured separately when the problem concerns navigation, bookmarks, history,
or site-data controls:

```bash
cliwebctl --pane %N screenshot --toolbar --output /tmp/toolbar.png
```

## A good handoff prompt

With the `control-cliweb` skill installed, a complete request can be as short as:

```text
Use $control-cliweb to open the app in the right tmux pane. Inspect the current page, reproduce the
bug, and verify the result after I make a manual change. Stop before any external submission.
```

This tells Codex to use the structured control path while keeping the browser visible and available
for human intervention.
