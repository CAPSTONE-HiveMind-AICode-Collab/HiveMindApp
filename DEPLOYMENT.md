# Firebase Deployment Guide

## Prerequisites

1. **Install Firebase CLI**
```powershell
npm install -g firebase-tools
```

2. **Login to Firebase**
```powershell
firebase login
```

3. **Update Firebase Project ID**
Edit `.firebaserc` and replace `YOUR_PROJECT_ID` with your actual Firebase project ID.

## Environment Variables

Create `.env.local` with the following:

```env
# Firebase Config (existing)
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-XXXXXXX

# FCM (Cloud Messaging) - NEW
NEXT_PUBLIC_FIREBASE_VAPID_KEY=your_vapid_key_from_firebase_console

# App Check (reCAPTCHA v3) - NEW
NEXT_PUBLIC_FIREBASE_APP_CHECK_KEY=your_recaptcha_v3_site_key

# Gemini AI (existing)
GENAI_API_KEY=your_gemini_api_key
```

## Setup Steps

### 1. Get VAPID Key (for Cloud Messaging)

In Firebase Console:
1. Go to Project Settings > Cloud Messaging
2. Scroll to "Web Push certificates"
3. Click "Generate key pair"
4. Copy the key and add to `.env.local` as `NEXT_PUBLIC_FIREBASE_VAPID_KEY`

### 2. Setup reCAPTCHA v3 (for App Check)

1. Go to https://www.google.com/recaptcha/admin
2. Click "+" to create new site
3. Choose reCAPTCHA v3
4. Add your domain (and `localhost` for testing)
5. Copy the **Site Key** to `.env.local` as `NEXT_PUBLIC_FIREBASE_APP_CHECK_KEY`
6. In Firebase Console > App Check, register your web app with the reCAPTCHA site key

### 3. Update Service Worker

Edit `public/firebase-messaging-sw.js`:
- Replace `YOUR_API_KEY`, `YOUR_PROJECT_ID`, etc. with your actual Firebase config

### 4. Install Cloud Functions Dependencies

```powershell
cd functions
npm install
cd ..
```

### 5. Set Cloud Functions Environment Variables

```powershell
firebase functions:config:set gemini.api_key="your_gemini_api_key"
```

## Deployment

### Option 1: Deploy Everything

```powershell
npm run deploy
```

This will:
1. Build Next.js app with static export
2. Deploy to Firebase Hosting
3. Deploy Cloud Functions
4. Deploy Firestore Rules
5. Deploy Storage Rules

### Option 2: Deploy Selectively

**Hosting only:**
```powershell
npm run build
firebase deploy --only hosting
```

**Functions only:**
```powershell
firebase deploy --only functions
```

**Rules only:**
```powershell
firebase deploy --only firestore:rules,storage:rules
```

## Upgrade to Blaze Plan (Required for Cloud Functions)

1. Go to Firebase Console > Project Settings > Usage and billing
2. Click "Modify plan"
3. Select "Blaze (Pay as you go)"
4. Add credit card (won't charge unless you exceed free tier)
5. Set budget alert at $10/month to avoid surprises

## Free Tier Limits

**Cloud Functions:**
- 2 million invocations/month (FREE)
- Typically $0-$2/month for capstone usage

**Cloud Messaging:**
- Unlimited push notifications (FREE)

**Hosting:**
- 10 GB storage, 360 MB/day bandwidth (FREE)

**Firestore:**
- 1 GB storage, 50k reads/day, 20k writes/day (FREE)

**Storage:**
- 5 GB storage, 1 GB/day downloads (FREE)

## Testing Locally

### Test Cloud Functions

```powershell
cd functions
npm run serve
```

This starts the Firebase Emulator for testing functions locally.

### Test Hosting

```powershell
npm run build
firebase emulators:start --only hosting
```

## Verify Deployment

After deployment, Firebase CLI will show:
- **Hosting URL**: `https://YOUR_PROJECT.web.app` or `https://YOUR_PROJECT.firebaseapp.com`
- **Functions**: List of deployed functions

Visit the hosting URL to see your live app!

## Monitoring

### Check Logs

```powershell
firebase functions:log
```

### Check Cloud Function Status

Firebase Console > Functions > Dashboard

### Check Hosting Analytics

Firebase Console > Hosting > Dashboard

## Troubleshooting

**Error: "Missing or insufficient permissions"**
- Deploy firestore rules: `firebase deploy --only firestore:rules`

**Error: "Cloud Functions require Blaze plan"**
- Upgrade to Blaze plan (see above)

**Error: "App Check validation failed"**
- Verify reCAPTCHA key in `.env.local`
- Check App Check is enabled in Firebase Console

**Notifications not working:**
- Verify VAPID key is correct
- Check service worker is registered: DevTools > Application > Service Workers
- Ensure HTTPS (required for notifications, except localhost)

## Cost Monitoring

Set up budget alerts:
1. Google Cloud Console > Billing > Budgets & alerts
2. Create budget: $10/month
3. Alert at 50%, 90%, 100%
4. Enable auto-shutdown if desired

## What Gets Deployed

✅ **Hosting**: Static Next.js site at `https://YOUR_PROJECT.web.app`
✅ **Cloud Functions**: 6 serverless functions
  - `generateThreadSummary` - Auto AI summaries when threads close
  - `cleanupTempFiles` - Daily cleanup of old temp files
  - `logHiveDeletion` - Auto audit logging
  - `logRoleChange` - Auto audit logging
  - `logMemberAdded` - Auto audit logging
  - `logFileUpload` - Auto audit logging
✅ **Firestore Rules**: Security rules for database
✅ **Storage Rules**: Security rules for file uploads
✅ **Indexes**: Firestore composite indexes for queries

Your capstone app will be live and production-ready! 🎉
