# Society Manager

Housing society management for Android (.apk) and Windows (.exe). All data stays on the device. There is no server and no internet requirement.

## Get the APK and EXE from GitHub

1. Create a new repository on GitHub (private is fine).
2. Upload everything from this folder (drag the unzipped files into the repository page, or use `git push`). The `.github` folder must be included.
3. Open the **Actions** tab. The **Build apps** workflow starts on its own. You can also run it by hand with **Run workflow**.
4. When it finishes (about 10 minutes), open the run and download:
   - **android-apk**: `SocietyManager-debug.apk` (and `SocietyManager-release.apk` if you set up signing below)
   - **windows-installer**: `Society Manager Setup 1.0.0.exe` (Windows 7, 8, 8.1, 10, 11)
   - **single-html-file**: `SocietyManager.html` (any device with a modern browser, no install)

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

## The single HTML file (runs anywhere)

Copy `SocietyManager.html` to any device and open it in Chrome, Edge, Firefox or Safari. Nothing is installed and no internet is needed. Data is kept in that browser on that device, so:

- Open the file in the same browser each time. A different browser has its own empty data.
- Clearing browser data or "site data" deletes the society data. Make a backup first, and make backups regularly.
- Private/incognito windows do not keep data.

## Minimum versions

- Android app: Android 5.1 or newer.
- Windows installer: Windows 7 or newer (built with Electron 22, which no longer gets security updates; the app works offline and never opens web pages, which limits the risk).
- HTML file: any browser from about 2020 onwards, including Chrome 109 on Windows 7.

## Messages (WhatsApp)

The **Messages** tab writes a message for each owner and opens WhatsApp with it ready. You press Send in WhatsApp.

- Choose a type: payment pending reminder, notice, festival wishes or a custom message. Edit the text if you like. `{name} {flat} {amount} {months} {society}` are filled in separately for each owner.
- Choose one owner (the **WhatsApp** button on their row) or tick several, or use **Select owners with dues**. Then press **Open WhatsApp for next owner** once for each person.
- Numbers: 10-digit Indian numbers get +91 automatically. For other countries type the number with a leading +. A separate WhatsApp number can be set on the flat.
- The app cannot send messages automatically or see whether they were delivered. That needs the paid WhatsApp Business service and an internet server.
- The history lists the messages that were opened.

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
- Everything you enter can be edited: society details and rules, flats (owner changes keep the old owner in the history), bills (maintenance, extra charges, penalty waiver), payments, and expenses. An edited expense goes back for approval.
- Every edit is written to a read-only history with the old and new values.
- Payments and expenses are never deleted. A payment entered by mistake is cancelled, and an approved expense is reversed, each with a reason. Flats are removed from the lists but their records are kept.
- The same payment reference (UTR / cheque number) cannot be recorded twice.
- Penalty: due on the 15th, no penalty up to the due date (plus any grace days), then fixed, percentage, per-day or monthly interest, with a maximum, an effective date and per-flat exemption. Payments made on time reduce the amount the penalty is calculated on. Once the maintenance is fully paid, the penalty is frozen.

## Not built yet

Expense and income screens, cash and bank books, reports and exports (PDF, Excel, CSV), PDF receipts, WhatsApp and email message links, user logins with roles and PINs, ownership transfer screen, Excel import, multiple societies, and the extra modules (notices, meetings, complaints and so on). The database tables for most of these already exist.
