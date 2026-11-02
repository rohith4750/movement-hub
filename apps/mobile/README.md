# Movement Hub – Staff App

React Native (Expo SDK 58, Expo Router) app for Movement Hub **staff**. Same navy/gold brand, logo and Montserrat font as the web portal, and the same REST API.

> Patient-facing login is a future phase. Today the system is internal management only.

## Sign-in

- **6-digit PIN only**: no mobile number. The app shows a PIN pad and signs in after the 6th digit.
- The admin sets the PIN when creating a staff member or physiotherapist on the web portal (Staff / Therapists → **Set PIN**) and can reset it at any time.
- Every staff member's PIN must be **different**. The web refuses a PIN that someone else already uses.
- Wrong PINs: 10 failed tries per device in 15 minutes, then a short wait. Successful sign-ins don't count.
- Staff can change their own PIN under **Me → Change PIN** (other devices are signed out).
- Weak PINs (111111, 123456, 121212 …) are refused.

## Screens (everything the web portal does)

**Tab bar:** Today · Visits · Patients · Sessions · More. Tabs and menu items appear only for roles that can use them, and the API enforces the same rules.

| Area | Screens | Roles |
|---|---|---|
| Today | Day stats, coming-up list, physio utilisation | All |
| Visits / Appointments | Day list → detail: confirm, check in, no-show, reschedule, cancel, **edit** (type / plan / notes), **delete**, consultation notes, write consultation | Admin, Reception, Physio |
| Book | Patient → visit → physio (free-slot counts per day) → Morning/Afternoon/Evening time | Admin, Reception |
| Schedule | Day grid per physio; block / unblock slots | Admin, Reception, Physio |
| Home visits | Date list, call, open in Maps, on my way, **GPS check-in**, check-out | Admin, Reception, Physio |
| Patients | Search, **register**, **edit**, **delete**, medical history, **sell package**, **create plan**, pain-progress chart | Admin, Reception, Physio, Accountant (view) |
| Consultation | Consultation + assessment (pain, ROM, special tests) + treatment plan, retry-safe | Physio |
| Treatment plans | List / search, detail, activate / complete / cancel | Admin, Reception, Physio |
| Sessions | Start (pain before) → complete (pain after, exercises, notes); uses package sessions | Admin, Physio |
| Billing | Filters, search, **new invoice** (GST preview), issue / cancel, record payment, **print / share PDF** & receipts | Admin, Reception, Accountant |
| Packages | Catalogue (admin create / edit / on-off sale), patient packages | Admin, Reception, Accountant |
| Reports | Date range, revenue, collections, by service, visits, utilisation, package sales, outstanding | Admin, Accountant |
| Therapists | List, **add (with PIN)**, weekly schedule editor, generate slots, leave (add / approve), set PIN, delete | Admin (Reception view) |
| Staff | List, **add (with PIN)**, set PIN, delete | Admin |
| Settings | Fees, GST, hours, slot length, cancellation / reminder hours, invoice prefix | Super Admin |
| Me | Account, change PIN, sign out | All |

Not on mobile (web only): CSV export, refunds.

## Run it

The API must be running (`npm run dev` in the repo root starts API + web).

```bash
cd apps/mobile
npm install          # first time only — this app has its own node_modules
npm start            # scan the QR code with Expo Go, or press a / i
```

The app finds the API on the computer running `expo start` (port 3000, the Next.js server), so a phone on the same Wi-Fi works with no setup. Android emulator falls back to `10.0.2.2`. For production builds set:

```bash
EXPO_PUBLIC_API_URL=https://api.movementhub.example/api/v1
```

## Checks

```bash
npm run typecheck    # TypeScript
npx expo lint        # ESLint (incl. React Compiler rules)
npx expo-doctor      # Expo config / dependency health
```

## Notes

- Kept outside the npm workspaces on purpose (own React / React Native versions); `metro.config.js` pins Metro to this folder's `node_modules`.
- Tokens are stored in the device Keychain / Keystore (`expo-secure-store`).
- Native builds: `npx eas-cli@latest build`.
