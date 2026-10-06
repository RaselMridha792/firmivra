# SES production access request (us-east-1)

> **Status: send before delivery (Oct 18, 2026); needs company details from Octavia.**
> Not sent. Until then SES stays in the sandbox: 200 emails a day, only to verified addresses (the team's addresses are verified for testing).

## Before sending

- [ ] Company details from Octavia, filled in `apps/web/src/lib/company.ts` (legal name, address, support email, privacy and terms URLs).
- [ ] firmivra.com describes the product, with the company name, a privacy policy and contact details. Today it is a GoDaddy "Launching Soon … Subscribe for updates" page; AWS reviewers check the website, and a coming-soon page with a newsletter sign-up is a common reason for refusal.
- [ ] Re-read the text below against what the product actually sends by then.
- [ ] Production access is for the whole AWS account in us-east-1, so it also covers prod later.

## Request fields

| Field | Value |
|---|---|
| Mail type | Transactional |
| Website URL | https://firmivra.com |
| Contact language | English |
| Additional contact | Rasel confirms the address when sending (not stored in this public repo) |

## Use case description

Firmivra is a multi-tenant web platform for accounting and tax firms, in development, with delivery to its first firm on Oct 18, 2026. Each firm gets a workspace for its staff and a branded portal for its own clients.

We will send transactional email only: from no-reply@dev.firmivra.com for our development environment now, and later from our production domain in this same account. The emails are:
- 6-digit email verification and password-reset codes;
- invitations that a firm sends to its own staff and clients (link valid 72 hours);
- notices that a new message, document request or appointment change is waiting in the portal (the email never contains the message or the document itself);
- appointment confirmations and reminders;
- status updates on a firm's application to join the platform (approved, more information needed, declined).

We do not send marketing or newsletters, and we never send to purchased, rented or scraped lists. Every recipient either has an account on the platform or was invited by a firm they already work with. Users will be able to choose which notifications they receive; security and account emails always go out.

Expected volume: under 100 emails a day during development and testing until the beta; after launch, under 5,000 a month at first, growing with the number of firms.

Bounces and complaints: dev.firmivra.com is verified with Easy DKIM, a custom MAIL FROM domain (mail.dev.firmivra.com, SPF) and DMARC (p=quarantine). All mail goes through a configuration set that requires TLS, records reputation metrics and suppresses addresses that bounced or complained, and the account-level suppression list is on for bounces and complaints, so we never send again to such an address. Emails never contain passwords, tax documents, Social Security numbers or financial account numbers.

## Command (Rasel runs it, after review)

Save the use case description above to `ses-use-case.txt` (outside the repo), then:

```bash
aws sesv2 put-account-details --production-access-enabled --mail-type TRANSACTIONAL \
  --website-url https://firmivra.com --contact-language EN \
  --use-case-description file://ses-use-case.txt \
  --additional-contact-email-addresses <contact address> \
  --profile firmivra-dev --region us-east-1
```

AWS answers in the support case, usually within a day. Check with `aws sesv2 get-account --profile firmivra-dev --region us-east-1` (`ProductionAccessEnabled`).
