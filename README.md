# Conversation → Book v2.8.15

A local Vite + React app for turning formatted social-conversation transcripts into book-style layouts.

## iMessage input modes
- **Paste text → convert:** paste one `Name: message` per line. Each line is a separate bubble, even when the same character speaks twice in a row. Wrapped continuation lines are appended to the current message.
- If exactly two unique speakers are detected, the app asks which name belongs on the left and which belongs on the right before importing. The left character becomes the default editable page title.
- If three or more unique speakers are detected, the app asks who should be on the right. Choose one detected character to put only that person on the right; all other speakers stay on the left. Choose “None · keep everyone on the left” to keep every speaker on the left. Names and repeated message lines remain separate.
- **Manual:** continue to create messages using the existing character library, 1-on-1/group modes, message reorder controls, standalone middle text, and long or 17 cm split exports.
- Screenshot-reading OCR and Tesseract.js have been removed from iMessage.

## Tweet mode
Tweet mode remains manual and retains its character library, public/private lock, replies, nested replies, quote posts, alignment controls, and export workflows.

## Install and run
Install a current Node.js LTS release, open this project folder in VS Code, then run:

```cmd
npm install
npm run dev
```

Open the local address Vite prints, usually `http://localhost:5173/`, in your browser. For subsequent sessions you normally only need `npm run dev`.

## Notes
- The package keeps pinned dependency versions and the `electron-to-chromium` override used by the preceding working version.
- No `node_modules` is bundled; npm installs dependencies on your machine.


## v2.8.15 update

When pasted conversation text is detected as a group (three or more unique speaker names), the app now asks “Who is on the right?” The selector includes every detected speaker plus “None · keep everyone on the left.” If one speaker is selected, only that speaker's messages use right-side outlined bubbles; every other speaker remains on the left in gray. Choosing None keeps all messages on the left. The 1-on-1 side assignment flow is unchanged.

## Publish the exact v2.8.15 app through GitHub Pages

This GitHub-ready edition changes **only** `vite.config.js` and adds the
`.github/workflows/deploy.yml` publishing workflow plus `.gitignore` and
this documentation. The original `src/` and `index.html` are untouched.

### One-time setup

1. Create a new **public** repository at https://github.com/new, using
   `conversation-book-converter` (or any name) and the **main** branch.
   Don't use an existing repository for another project.
2. Extract this ZIP. Upload **the contents of the extracted folder** to
   the root of the new GitHub repository, keeping the `.github/workflows/deploy.yml`
   folder/file path intact. The repository root should contain `package.json`,
   `index.html`, `vite.config.js`, and `src/`. Do not upload the ZIP alone.
3. In GitHub, visit **Settings → Pages → Build and deployment → Source**
   and choose **GitHub Actions**. (You need repository settings access.)
4. Visit **Actions** and inspect the deployment workflow. If it already ran
   before Pages was enabled, select **Deploy Conversation Book to GitHub Pages**
   then **Run workflow** (branch `main`).
5. When the workflow completes, your website should be located at
   `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.
   GitHub also shows the actual URL at **Settings → Pages**.

Every subsequent push to `main` automatically rebuilds and publishes the site.
The same project remains runnable locally with `npm install` / `npm run dev`.

### Data, storage, and exports

- This app is fully client-side; GitHub Pages provides HTTPS static hosting.
  No always-on Node.js server is needed.
- Tweet and iMessage character libraries use **browser localStorage**, so
  entries stored under `http://localhost:5173` will not carry over to the
  published HTTPS URL. Libraries also do not automatically sync between browsers.
- Current editing workspace content is not automatically saved or synchronized.
- PNG and PDF generation runs in the user's browser, as before.
- A public GitHub repository exposes the uploaded source code to everyone.
  Do not commit private conversations, passwords or account credentials.

### Technical details

- `base: './'` in Vite works with both GitHub Pages project URLs and localhost.
- Workflow runs on `main` and can be run manually from Actions.
- Since the supplied archive does not include a package lock, the workflow uses
  `npm install` rather than `npm ci`.
- If publishing to a custom domain or a different hosting provider later,
  the same source remains usable.
