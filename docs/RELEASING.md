# Releasing a new version

Releases are built by GitHub Actions on Windows, not on your PC. Installed copies of VormCraft
find the new version on their own (they read `latest.json` from the newest GitHub Release) and
offer to install it.

## Every release

1. Make sure everything you want is committed and the tests pass (`npm test`).
2. Set the version (it is written in three places; this does all of them):
   ```bash
   npm run version:set -- 0.3.0
   ```
3. Add a `## 0.3.0` section at the top of `CHANGELOG.md`. Write it for the people using the app:
   it is what the update prompt shows them. Keep it to plain sentences and `- ` bullet lines, with
   no `**bold**` or other formatting: VormCraft 0.2.0 and older show the notes as plain text, so
   formatting marks would appear as stray symbols there.
4. Commit, tag and push:
   ```bash
   git commit -am "Release 0.3.0"
   git tag v0.3.0
   git push && git push --tags
   ```
5. Watch the **Actions** tab on GitHub. In about 15 minutes the release appears under
   **Releases** with the installer (`VormCraft_0.3.0_x64-setup.exe`) and `latest.json`.

The release workflow refuses to build if the tag and the app version differ, or if any test fails.

Version numbers: `major.minor.patch`. Bump the patch for fixes (0.2.0 → 0.2.1), the minor for new
features (0.2.1 → 0.3.0).

## The update signing key

Updates are signed so installed copies only accept updates made by you. The private key lives in
two repository secrets (Settings → Secrets and variables → Actions):

- `TAURI_SIGNING_PRIVATE_KEY`: the private key
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password

The matching public key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
**Keep a backup of the private key and password somewhere safe.** If they are lost, existing
installs cannot be updated automatically any more: people would have to download and install the
next version by hand once.

## Saved files stay compatible

- Every `.vorm` file says which format version it was saved in, and the app reads all older ones.
- When the file format changes: bump `FORMAT_VERSION` in `src/io/fileFormat.ts`, keep reading
  the older versions, and add a sample file `tests/fixtures/format-vN.vorm` (saved by the new
  code) plus its case in `tests/compatibility.test.ts`. Never edit or delete the older samples.
- A file saved by a newer version is refused with an offer to update.
- The first time someone saves over a file from an older format, a copy of the original is kept
  next to it (`Name (format 4 backup).vorm`).

## Windows SmartScreen

The installer is not code-signed, so the first time someone runs it Windows shows
"Windows protected your PC". They click **More info → Run anyway**. Updates installed from inside
the app do not show this. A code-signing certificate can be added to the workflow later.
