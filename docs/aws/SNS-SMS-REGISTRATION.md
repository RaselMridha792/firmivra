# SNS SMS registration (US toll-free number, us-east-1)

> **Status: send before beta (Jan 8, 2027); needs company details from Octavia.**
> Not sent. Review takes about 2 to 3 weeks and the number cannot send until it is approved. The earlier target was to submit by Oct 16 so that SMS works by Sprint 2 (Nov 2). Until then the API writes SMS to its log in dev.

The console clicks are in `docs/SETUP-LOG.md` under "SNS SMS steps". This page lists what the registration asks for.

## What the registration needs

| Item | Value | Status |
|---|---|---|
| Legal company name | From Octavia | Pending |
| Business address | From Octavia (street, city, state, ZIP, country) | Pending |
| Business registration number | EIN, if the form asks for it | Pending |
| Website | https://firmivra.com, live, describing the product, with a privacy policy that covers SMS | Pending (coming-soon page today) |
| Contact | Name, email and phone of the person AWS contacts about the registration | Pending |
| Use case | One-time passcodes and account notifications for users of the client portal and firm workspace; no marketing | Draft below |
| Opt-in | The user enters their phone at sign-up and verifies it with a 6-digit code. Screenshot: `docs/mockups/client-portal/Verify phone.png` | Ready |
| Opt-out and help | STOP stops all messages; HELP answers with the support email from `apps/web/src/lib/company.ts` | Needs the support email |
| Monthly volume | Under 1,000 messages a month during the beta | Ready |
| Sample messages | Below | Draft |

## Sample messages (draft)

Each names the brand and says how to opt out. `{Firm name}` stands for the business the user belongs to; never put real client data in samples.

1. `Firmivra: your verification code is 123456. It expires in 10 minutes. Reply STOP to opt out.`
2. `Firmivra: {Firm name} sent you a secure message. Sign in to the portal to read it. Reply STOP to opt out, HELP for help.`
3. `Firmivra: reminder of your appointment with {Firm name} on {date} at {time}. Reply STOP to opt out, HELP for help.`

## Before sending

- [ ] Company details from Octavia, filled in `apps/web/src/lib/company.ts`.
- [ ] firmivra.com live with the privacy policy (SMS section) and terms.
- [ ] Exit the SMS sandbox and raise the spend limit (same support case), then request the toll-free number and submit this registration.
