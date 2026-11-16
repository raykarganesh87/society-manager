# Society Manager

Housing society management for Android (.apk) and Windows (.exe). All data stays on the device. There is no server and no internet requirement.

## Get the APK and EXE from GitHub

1. Create a new repository on GitHub (private is fine).
2. Upload everything from this folder (drag the unzipped files into the repository page, or use `git push`). The `.github` folder must be included.
3. Open the **Actions** tab. The **Build apps** workflow starts on its own. You can also run it by hand with **Run workflow**.
4. When it finishes (about 10 minutes), open the run and download:
   - **android-apk**: `SocietyManager-debug.apk` (and `SocietyManager-release.apk` if you set up signing below)
   - **windows-installer**: `Society Manager Setup 1.0.0.exe`

If a step fails, open it in the Actions log and send me the error text.

### Signed release APK (optional)

Create a signing key once, on any computer with Java:

    keytool -genkeypair -v -keystore release.keystore -alias society -keyalg RSA -keysize 2048 -validity 10000

Keep this file and its passwords safe. You need the same key for every future update. Then in GitHub, go to Settings > Secrets and variables > Actions and add:

| Secret | Value |
|---|---|
| ANDROID_KEYSTORE_BASE64 | the keystore file as base64 (`base64 -w0 release.keystore`) |
| ANDROID_KEYSTORE_PASSWORD | keystore password |
| ANDROID_KEY_ALIAS | `society` |
| ANDROID_KEY_PASSWORD | key password |

## Install

- **Android:** copy the APK to the phone and open it. Allow "Install unknown apps" when asked.
- **Windows:** run the setup EXE. Windows may show a SmartScreen warning because the installer is not code-signed. Choose More info > Run anyway.

## Moving data between phone and PC

Open the **Backup** tab on either device.

- **Copy backup text**, then paste it into the **Paste backup text here** box on the other device (send it to yourself by WhatsApp, Telegram or email), and tap **Restore from pasted text**.
- Or **Save backup file** and use **Restore from file** on the other device.

Restoring replaces all data on that device. The previous data is kept, and **Undo last restore** brings it back. A damaged or incomplete backup is rejected before anything changes.

## Where the data is stored

- Android: the app's private storage (`society.db`). Uninstalling the app deletes it, so make a backup first.
- Windows: `%APPDATA%\Society Manager\society.db`.

## Run on your computer for development

    npm install
    npm test          # penalty engine tests
    npm run dev       # web preview in the browser
    npm run electron  # desktop window

## Rules built into the data layer

- One bill per flat per month. A penalty is stored on the bill, never added twice.
- Payments and ledger entries cannot be edited or deleted. Mistakes are fixed with a reversal entry.
- The same payment reference (UTR / cheque number) cannot be recorded twice.
- Penalty: due on the 15th, no penalty up to the due date (plus any grace days), then fixed, percentage, per-day or monthly interest, with a maximum, an effective date and per-flat exemption. Payments made on time reduce the amount the penalty is calculated on. Once the maintenance is fully paid, the penalty is frozen.

## Not built yet

Expense and income screens, cash and bank books, reports and exports (PDF, Excel, CSV), PDF receipts, WhatsApp and email message links, user logins with roles and PINs, ownership transfer screen, Excel import, multiple societies, and the extra modules (notices, meetings, complaints and so on). The database tables for most of these already exist.
