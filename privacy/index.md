> DRAFT — needs a lawyer's review before the public store launch.

# Privacy Policy

Effective 10 November 2026

Claryo is operated by Michael Lorenzo Ponce Sanchez, an individual developer. This policy states what Claryo stores, where, who receives it, and how deletion works.

## At a glance

- Claryo is a paid download. There are no in-app purchases, no ads, and no analytics or tracking SDKs.
- Your data is never sold and never shared for advertising.
- You sign in with email and password, Sign in with Apple, or Sign in with Google.
- The money plans you enter are stored on our servers. The display name in your greeting and your layout preferences stay on your phone.
- Claryo does not collect bank logins, account or card numbers, government ID numbers, location, contacts, photos or microphone input.
- Crash reports go to Sentry. They exclude your email, IP address and amounts.
- Settings › Delete Account removes your login and all your data at once.

## Signing in

You can create an account with email and password, Sign in with Apple, or Sign in with Google. Our login system, Supabase Auth, handles all three.

- **Email sign-up.** The login system keeps your email and a hashed password.
- **Apple.** Apple shares your email with the login system. If you choose Apple's "Hide My Email", that is Apple's relay address. The name Apple shares stays on your phone only.
- **Google.** Google shares your name, email and profile picture with the login system.

## What we store on our servers

Our servers run on Supabase (database, login and hosting). The servers are in Seoul, South Korea (Supabase's ap-northeast-2 region).

- **Profile settings.** Home currency, time zone, and onboarding progress dates. The profile holds no name and no email.
- **What you enter to plan money.** Income plans and their allocations (amounts, categories, due dates, and any names you type). Tracked accounts (provider name, optional account name, type, values and value history). Debts (name, balance, rate). Earmarks (names and targets). Insurance policies (insurer, cover amounts, premium, billing date). Coverage goals. The colours and initials you pick for providers.
- **Reminders.** Your notification preferences and a log of which reminders fired.
- **Portfolio check-ins.** The dates of your check-ins. No amounts.
- **Feedback board.** Your posts and votes. Every other user can see a post without the author's name or account. You can delete your own posts.

## What stays on your phone

- The display name shown in your greeting
- Hide Amounts
- Theme and layout preferences
- Planning settings such as projection assumptions

This data is removed when you delete the app.

## What we do not collect

- Bank logins
- Account or card numbers
- Government ID numbers
- Location
- Contacts
- Photos or microphone input

Claryo never reads your Photos. If you share a month summary through the system share sheet, you may choose to save that image to Photos yourself.

## Security

Each user's rows are protected by database row-level security: a signed-in account can read only its own rows. The feedback board is the exception, described above. Data is encrypted in transit (TLS) and at rest (Supabase).

## Other services

- **Sentry** receives crash and error reports so we can fix bugs. A report includes the device model, OS version, app version and the steps leading to the error. It excludes IP addresses, emails and amounts. The trail of steps is cleared whenever the signed-in account changes. Sentry keeps reports for up to 90 days.
- **Apple and Google** handle sign-in, the purchase, and the optional "rate this app" prompt. Their own privacy policies apply to what they collect.
- **Exchange rates** are fetched by our server from a public rates service (exchangerate-api.com). No user data is sent.
- **Fonts** are bundled in the app. Nothing is fetched at runtime.

## Deleting your data

Settings › Delete Account deletes your login record and every row of your data at once. Nothing is kept and nothing is soft-deleted.

**Without the app:** email claryoapp@gmail.com from the address you sign in with, with the subject "Delete my account". Your account and all its data are deleted the same way within 30 days, and you get a reply when it is done.

Crash reports already sent to Sentry are kept for up to 90 days, then deleted. Data stored only on your phone goes when you remove the app.

## Your rights

You can correct anything by editing it in the app. You can delete everything from Settings.

Settings › Account › Export my data gives you a copy of everything Claryo stores for you on its servers, as spreadsheet files in one .zip.

For any privacy question, contact claryoapp@gmail.com.

## Children

Claryo is not directed at children. You must be at least 18 to use it.

## Changes to this policy

When this policy changes, the new version replaces this one in the app, with a new effective date at the top.
