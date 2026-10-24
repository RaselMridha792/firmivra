# R1: prod, drafts for Rasel's yes (Oct 24 morning)

Rasel asked for these on Oct 23 night ("From me, follow it."). Everything here is a draft: nothing was submitted to AWS, nothing was created in AWS, and nothing was changed at GoDaddy. Each section ends with what R1 needs from Rasel. The checklist these steps belong to is in `docs/work/R1-cicd.md`, "Prod go-live checklist (Oct 22)".

Prod runs in the same AWS account as dev (778127141557, us-east-1), in its own `firmivra-prod-*` stacks.

## 1. SES production access

**Why:** the account's SES is still in the sandbox. That means 200 emails a day, and only to addresses verified in SES. Prod can't send sign-in codes, invitations or notices to real people until AWS grants production access. AWS reviews a request in about a day and may ask questions. The account is shared, so the grant also lifts dev's sandbox.

**Where:** AWS console, SES (us-east-1), Account dashboard, "Request production access". Or `aws sesv2 put-account-details` with the same text.

**What to enter:**

- **Mail type:** Transactional
- **Website URL:** `https://firmivra.com`. AWS looks at the site. If firmivra.com doesn't yet describe the product, add a short page that does before sending, or expect a follow-up question.
- **Use case description** (paste as is; edit the volume if you expect more):

> Firmivra is a multi-tenant web platform for tax and accounting firms. Each firm uses its own workspace (app.firmivra.com) to work with its clients, and each firm's clients use a client portal (portal.firmivra.com) in the firm's branding. We send transactional email only, from no-reply@firmivra.com, through Amazon SES with a verified domain identity (DKIM signed), a custom MAIL FROM domain (mail.firmivra.com) and a DMARC policy of quarantine.
>
> The emails are: sign-in and verification codes and password resets for firm staff and clients; invitations, sent when a firm adds a staff member or invites one of its own clients to the portal; appointment confirmations and reminders; invoice and payment notices; notices that a document or form is ready or needs attention; and messages a firm sends to its own clients from inside the platform.
>
> Recipients are only people with an account on the platform or a client relationship with the firm that sends to them: firm staff and the firm's own clients. We never buy, rent or import address lists. We don't send marketing to people without an account. A firm's messages to its clients honour each client's consent and unsubscribe status, and every non-essential notification can be turned off in the recipient's notification settings.
>
> Bounces and complaints: our SES configuration set uses the SES suppression list for bounces and complaints, so we never send to those addresses again. It also tracks reputation metrics and requires TLS. We monitor the bounce and complaint rates in CloudWatch and keep them well under the SES thresholds.
>
> Expected volume at launch: under 1,000 emails a day (our first firm), growing with the number of firms. Peak sending rate: a few emails a second.

- **Additional contacts:** an address you read (yours or the company's), so AWS's questions reach you.
- **Preferred contact language:** English.

**Needs from Rasel:** your yes, and then you submit it from the console (it needs your SSO sign-in). Or tell R1 to run the CLI version after `aws sso login --profile firmivra-dev`.

## 2. firmivra.com in Route 53

**Why:** the prod stacks need a Route 53 hosted zone for `firmivra.com`. It holds the certificate's validation records, the three site records (admin, app, portal) and SES (3 DKIM records, MAIL FROM, DMARC). Today GoDaddy serves the domain's DNS, and only `dev.firmivra.com` is delegated to Route 53 (zone `Z09182951RY8TUAZ5WCXR`, since Oct 5).

**Plan:**

1. **Before anything:** lower the TTL of every record at GoDaddy to 600 seconds (10 minutes), a day before the switch if you can. Old answers then expire quickly.
2. **Create the zone** (Rasel's yes; R1 runs it after `aws sso login`). The command prints the zone's 4 name servers:
   `aws route53 create-hosted-zone --name firmivra.com --caller-reference firmivra-com-<date> --hosted-zone-config Comment="Firmivra prod" --profile firmivra-dev`
3. **Copy every record GoDaddy has today** into the new zone, exactly (same names, types, values and TTLs). That includes the dev delegation. Skip GoDaddy's own NS and SOA (Route 53 makes its own). R1 writes the change batch from the list in "Needs from Rasel" below and shows it to you before running it.
4. **Check before switching:** query the new zone's name servers directly, for example `nslookup -type=MX firmivra.com <one of the zone's name servers>`. Every record must answer as GoDaddy does today.
5. **Switch:** Octavia replaces the domain's name servers at GoDaddy with the zone's 4. If GoDaddy's DNSSEC is on, turn it off first; a mismatched DNSSEC would take the whole domain offline.
6. **After the switch:** the website, company email and `dev.firmivra.com` keep working. Then R1 opens a small PR that puts the zone id into `infra/src/config.ts` (prod's `hostedZoneId`, `PENDING-firmivra-com` until then) and into the CDK bootstrap policy's `HOSTED_ZONE_IDS`. Until that PR merges, prod can't synthesize for a deploy (#1066).

**Needs from Rasel (exact values, copied from GoDaddy; R1 guesses none of them):**

The simplest way is GoDaddy's zone file export: Domain, DNS, Records, "Export zone file". Send the whole file. Otherwise, send these lines from the DNS records page, each with its name (Host), type, value (Points to), priority where shown, and TTL:

- every **A** and **AAAA** record (the website at `@`, and any others);
- every **CNAME** (`www` and any others, such as a mail provider's `autodiscover`, or verification and DKIM records like `*._domainkey`);
- every **MX** record (company email), with its priority;
- every **TXT** record: SPF (`v=spf1 ...`), `_dmarc` if there is one, and verification strings (Google, Microsoft, others);
- every **SRV** record (Microsoft 365 adds some);
- every **CAA** record, if any;
- the **4 NS records for `dev`** (the `dev.firmivra.com` delegation). Without them `dev.firmivra.com` goes offline after the switch;
- any **other subdomain** records, and any **forwarding** set up in GoDaddy (domain or subdomain forwarding is a GoDaddy feature, not a DNS record, so it would stop working after the switch and needs its own plan);
- whether **DNSSEC** is on for the domain.

Also tell R1 who provides the company email (Google Workspace, Microsoft 365, GoDaddy email or other). GoDaddy-hosted email or a GoDaddy website may depend on GoDaddy's DNS in ways the export doesn't show.

## 3. SMS: a toll-free number

**Why:** US carriers block application SMS that isn't from a registered number. SNS needs an origination number: a toll-free number with an approved registration (a few days to a few weeks), or a 10DLC number with a brand and campaign (slower, more paperwork). Dev has the same gap: the API sends with `SMS_MODE=sns` and no `SMS_ORIGINATION_NUMBER`, so dev SMS is unreliable or blocked today. One registered number can serve both dev and prod: the use case is the same, the account is the same, and dev's volume is tiny.

**Recommendation:** one toll-free number, registered for transactional messages. Prod can start without SMS (email covers every code and notice) and turn SMS on when the registration is approved.

**What the registration asks for** (AWS End User Messaging SMS, us-east-1, "Request originator", toll-free, then "Registrations"):

- **Company:** legal name, address, website (`https://firmivra.com`), tax id (EIN), and a contact's name, email and phone. **From Rasel.**
- **Use case:** account notifications and one-time passcodes. Messages: sign-in and verification codes, appointment reminders, and notices that a document, form or invoice needs attention, for the platform's users (firm staff and the firms' clients).
- **Expected monthly volume:** for example under 1,000 messages a month at launch. **Rasel to confirm.**
- **Opt-in:** how a person agrees to SMS. Today SMS notifications are off by default for each person, who turns them on in their notification settings. Rasel's Settings plan (R60, "Notifications next") also sends SMS only after a verified mobile number; that is being built. AWS wants a screenshot or URL of where the person opts in, and the exact wording beside it. **Needs Octavia's screen wording;** R1 can draft the text.
- **Sample messages** (2 or 3, with the firm's name where it appears), for example: "Firmivra: your sign-in code is 123456. It expires in 10 minutes. Reply STOP to opt out." and "Lakeview Tax: reminder of your appointment on Oct 30 at 10:00 AM. Reply STOP to opt out." (synthetic examples; the registration needs our real templates' wording).
- **Opt-out and help:** STOP and HELP keywords with their replies. AWS handles STOP itself; we write the HELP reply.

**Also needed (Rasel, in the console):**

- The **SMS sandbox:** the account starts in it (only verified destination numbers). Request moving out once the number is approved.
- The **spend limit:** the account's monthly SMS spend limit starts low (often $1). Request a limit that fits the volume.

**After approval (R1, a small infra PR):** set `SMS_ORIGINATION_NUMBER` on the API task for dev and prod (`infra/src/stacks/app-stack.ts`, from config), and let the API role send from that number. That fixes dev's missing origination number too.

**Needs from Rasel:** the company details and volume above, a yes to request the number, and Octavia's opt-in wording.

## 4. The first prod Super Admin and LVP (a request for Rasel, not code)

**Why:** prod starts empty. `link-dev-users` (`packages/db/src/link-users.ts`) refuses anything but `APP_ENV=dev`, as it should, and the seed never runs in prod. Prod needs one reviewed one-off that creates the first Super Admin and the LVP firm. It is `packages/db` code, so it needs Rasel's own tap before anyone writes it.

**Requested one-off** (`packages/db/scripts/bootstrap-prod.mjs`, run once as an ECS task on the prod migrate task definition, like the dev one-offs):

1. Runs only with `APP_ENV=prod` and an explicit `CONFIRM_PROD_BOOTSTRAP=yes`. Refuses to run again once a Super Admin exists, unless asked to add one more.
2. **Super Admin:** Rasel creates the user in the prod admins Cognito pool (console, MFA at first sign-in). The task gets only that user's `sub` (no email in the task overrides, which CloudTrail records). It creates the `users` row (pool ADMINS) and the `platform_admins` row (SUPER_ADMIN), and maps it in the platform org like `bootstrap-platform-org`. It writes a platform audit row.
3. **LVP:** the `businesses` row (slug `lvp`, ACTIVE, the legal name Rasel gives), empty `business_settings`, and the Owner's membership from a staff-pool user's `sub`. Rasel creates that user in the prod staff pool. LVP's details (contact, legal documents, branding) then come from the setup wizard, as on dev.
4. After it: `create-firm-key lvp` and its `--check` (the firm's KMS key), and `set-module` for LVP with reasons (`packages/db/scripts/set-module.mjs`), each a separate one-off as on dev.
5. Tests: refuses outside prod and without the confirmation, idempotent, writes the audit rows, and stores no email from the task's input.

**Needs from Rasel:** a yes for this one-off as a `packages/db` PR (R1 builds it), LVP's legal name, and the two Cognito users created in prod once the auth stack exists (their `sub`s go only into the task overrides).

## 5. Before the first prod deploy (from #1066 and #1067)

- **Bootstrap policies** (checklist step 7, your yes and SSO). Print them with `infra/scripts/bootstrap-policies.ts` and apply both with the AWS CLI, as on Oct 8. Since #1066 they also allow `application-autoscaling:*` and the ECS auto scaling service-linked role, which prod's 2-to-6-task scaling needs. `firmivra-cdk-cfn-exec` is at 5 of 5 policy versions, so delete its oldest non-default version first.
- **The prod stacks, in order** (checklist steps 10 to 13): each `cdk diff` is shown to you first, and each deploy waits for your yes. They are network, data, auth, email and ci, then the app through the first `v*` tag. `deploy-prod.yml` (#1067) builds, migrates, rolls out and smoke tests.
- **Narrowing dev's deploy role:** `cdk deploy firmivra-dev-ci -c env=dev` (your yes) makes `firmivra-dev-github-deploy` trust only the `dev` environment (#1067). Until then it still trusts `prod` too. Deploy dev keeps working either way.
- **Known with 2 or more tasks** (#1066's audit; none blocks prod, each is an API follow-up for its owner):
  - the API's rate limits count per task, so 2 to 6 tasks allow 2 to 6 times as many requests (sign-in lockouts are in the database and stay exact);
  - campaign delivery can send a recipient twice once send adapters exist (none in prod today);
  - the Begin Online sweep's 45 s budget outlasts the 30 s transaction cap;
  - two tasks can each make a KMS key for the same new firm (one stays unused).

## Order for the morning

1. SES request (section 1): submit first. It has the longest wait that nothing else blocks.
2. GoDaddy export (section 2), then R1 prepares the zone change batch for your yes.
3. SMS decision (section 3): start without SMS, or register the toll-free number now.
4. Super Admin and LVP one-off (section 4): your yes, then R1 builds it while the zone and SES settle.
5. The prod PRs wait for your review: #1066 (prod config and auto scaling), then #1067 (`deploy-prod.yml`, stacked on #1066). Nothing deploys prod until a `v*` tag, which only you create.
