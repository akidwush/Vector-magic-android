# Vector Magic Android — Source import

This repository is initialized. The complete Vector Studio source is ready to be imported via GitHub Actions.

**One-time source import:** download `Vector-Studio-Netlify-Source.zip` from the ChatGPT conversation, open this repository's **Add file → Upload files** page and upload the ZIP to the **repository root on main** without renaming it. Commit the upload. The [Import Vector Studio source ZIP](../../actions/workflows/import-source.yml) action automatically checks the exact archive SHA-256, runs tracing/backend tests and Netlify build, extracts the 106 original source files, and removes the temporary ZIP after successful import.

This preserves the source files and checksums; uploading a ZIP alone without the workflow would not be sufficient.

**After the import succeeds:** choose Netlify → **Add new project → Import an existing project → GitHub** → `akidwush/Vector-magic-android`. Netlify automatically reads `netlify.toml`. Check that it detects **build `bash scripts/build-netlify.sh`**, **publish `dist`**, **Functions `netlify/functions`**.

Live Vector Ink availability still needs verification on the Netlify preview; passing CI proves contract/integration using a simulated provider response, not live provider access.
