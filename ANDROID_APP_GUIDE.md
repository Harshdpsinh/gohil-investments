# Gohil Investments CRM Android App

This Android app is a free sideload wrapper around the live Vercel CRM:

```text
https://gohil-investments.vercel.app
```

It uses the same Firebase, Cloudinary, WhatsApp links, clients, policies, renewals, claims, tasks, commission, reports, and document data as the website.

## What This Gives You

- Same CRM features on Android as the website.
- Website updates appear in the Android app after Vercel redeploy, so you usually do not need to rebuild the APK for normal CRM fixes.
- Same Firestore database, so data stays synced between phone and desktop.
- Same Cloudinary PDF upload/view/download system.
- Free sideload APK. No Play Store account required.
- No separate backend needed.

## One-Time Setup

Install these free tools:

1. Node.js, already present for this project.
2. Android Studio from Google.
3. Android SDK through Android Studio setup.

Then install Android wrapper packages:

```powershell
cd "C:\Users\harsh\Desktop\GOHIL INSURANCE\WEB APP\gohil-investments"
npm install
```

## Build / Refresh The Android Project

Run:

```powershell
npm run android:sync
```

If Android project does not exist yet, run this once first:

```powershell
npm run android:add
```

## Create APK For Sideload

Option A, command line:

```powershell
npm run android:apk
```

APK output:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

Option B, Android Studio:

```powershell
npm run android:open
```

Then Android Studio:

```text
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

## Install On Phone

1. Copy `app-debug.apk` to your Android phone.
2. Open it on the phone.
3. Allow "Install unknown apps" if Android asks.
4. Install.
5. Log in with your same CRM user.

## Important Notes

- This APK opens your live Vercel website inside the app, so Vercel environment variables are used by the website exactly like desktop.
- If you change only CRM website code, push to GitHub and let Vercel deploy. The Android app will load the updated website.
- Rebuild the APK only when changing Android app name, icon, package ID, splash screen, or this Capacitor config.
- Debug APK is fine for your own sideload use. For Play Store release, create a signed release APK/AAB later.

## Renewal Safety

The Android app does not rewrite renewal logic. It uses the same `RenewalsPage`, `dateUtils`, `firestore`, and policy data as the website build.
