# "Begin Online" intake mockups: analysis (LVP Accounting & Taxes)

Source: 26 PNGs in `client-info/drive-folders/Begin online/`, all opened and reviewed. They are static design mockups with sample data on the review screens. No URLs or browser chrome appear in any of them.

**Correction to the folder naming:** the four "generic" screens (`business Information.png`, `Taxes & Income.png`, `Business Expenses.png`, `Review & Submit.png`) are not generic. All four are titled **"Quarterly Tax Intake Form"**. They are the flow behind the entry card "File Business Quarterly Taxes". That gives **six service flows**: Annual Tax (4 screens), Quarterly Tax (4), Bookkeeping (4), Payroll (3), Tax Planning (4) and Business Development (4). There are also 2 success pages and 1 entry page.

---

## 1. Where the flow lives

- **It is on the public marketing website and happens before login.** The entry page (`Begin online.png`) has the full site header: Home · About Us · Services ▾ · Resources ▾ · **Client Portal** · **Begin Online** (active, underlined in orange) · Contact, plus an orange **"Schedule an Appointment →"** button. The footer has the same links, social icons, Privacy Policy, Terms of Service and "© 2026 LVP Accounting and Taxes LLC".
- **Client Portal is a separate nav item.** Begin Online is not inside the portal. No screen has a "Sign in", "Log in", "Create account" or password field, and no screen shows a logged-in user.
- **No screen creates an account.** Every service form asks again for name, email and phone. Neither success page mentions a portal account, login credentials or an invite. They promise only a "confirmation email with a copy of your submission" and that a team member will reach out.
- **There are hints of a draft/resume mechanism.** Tax Planning and Business Development have a "Save and Continue Later" link. Bookkeeping has "Save & Exit" and Payroll has "Exit Form". An anonymous user can only resume through something like an emailed magic link or a resume token.
- Only the Annual Tax step 1 and the Quarterly review page keep the full site nav (and that nav **omits "Begin Online"**). All other form pages use a branded hero header with no nav, which suggests a standalone or embedded form shell.
- Every form shows a lock banner: "This is a secure and encrypted form. Your information is protected using industry-standard encryption." Every footer reads "Secure. Compliant. Confidential."

## 2. Entry screen: `Begin online.png`

- **Hero:** "SECURE. SIMPLE. CONVENIENT." / "Begin Online" / "Complete your intake form and securely submit your documents — all online." Laptop graphic with three ticked items: Fill Out Intake Form, Upload Documents, Submit Securely. CTA "Schedule an Appointment", "Let's find a time that works for you."
- **"Choose Your Service"** offers six cards, each with a button:

| Card | Tagline | Button | Leads to |
|---|---|---|---|
| Tax Preparation | Individual & Business Tax Returns: "…get started with your 2026 tax return" | Tax Intake Form (orange) | Annual Tax Intake Form (4 steps) |
| Business Bookkeeping | Keep Your Business on Track | Bookkeeping Intake Form (navy) | Business Bookkeeping Intake Form (4) |
| Payroll Services | Simple. Accurate. On Time. | Payroll Intake Form (orange) | Payroll Services Intake Form (3) |
| Business Development | Plan. Grow. Succeed. | Business Development Intake Form (navy) | Business Development Intake Form (4) |
| File Business Quarterly Taxes | Stay Compliant. Avoid Penalties. | Quarterly Tax Intake Form (orange) | Quarterly Tax Intake Form (4) |
| Tax Planning | Strategize Today for a Brighter Tomorrow | Tax Planning Intake Form (navy) | Tax Planning Intake Form (4) |

- **"4 Simple Steps"** gives the generic pattern: (1) Business Information, (2) Additional Details, (3) Upload Documents ("Examples will be provided in the intake form"), (4) Review & Submit ("read and sign (if required)"). A note says "These are the usual steps for all intake forms. The specific questions and documents may vary based on the service you select."
- **Bottom band:** "Same Goals Bigger Possibilities!" (script), "Ready to Get Started? Choose a service above or schedule an appointment today." Trust icons: Secure & Encrypted / Quick & Easy / Trusted Professionals.

---

## 3. Annual Tax Intake Form (Tax Preparation)

**Step indicator:** 1 Personal & Filing Information → 2 Business Income & Expenses → 3 Required Document Upload → 4 Review & Sign (Service) Agreement. The label wording varies from screen to screen (see §9).

### Step 1: Personal & Filing Information (`Annual Intake Form 1.png`)
Five numbered panels:
1. **Personal & Filing Information:** Full Legal Name* (First/Middle (if any)/Last); Date of Birth* (date picker); Phone Number*; Email Address*; SSN* (masked, eye toggle); Physical Address* (Street, City, State dropdown, ZIP); Filing Status* radio (Single, Married Filing Jointly, Married Filing Separately, Head of Household, Qualifying Surviving Spouse); "Are you claimed as a dependent on someone else's return?"* Y/N. **Type of Tax Return(s) You Need*** (multi-select checkboxes): Personal (1040), Business (1120, 1120-S, 1065, etc.), Both Personal & Business. **Legal Status in the U.S.*** radio: U.S. Citizen, Permanent Resident (Green Card), Non-Resident Alien, Other. **Did you serve in the U.S. Armed Forces?*** Y/N.
2. **Filing Details & Dependents.** *Spouse Information (if applicable):* full name, Spouse SSN (masked), DOB, Occupation, Employer, Phone, Email, Spouse Address (if different). *Dependents:* "Do you have any dependents?"* Y/N. When Yes, repeating "Dependent 1" cards (collapsible, delete icon) with Full Name*, DOB*, Relationship to you* (dropdown), SSN (if applicable), and checkboxes Lives with you / Full-time student / Disabled / Qualifies for Child Tax Credit. "+ Add Another Dependent".
3. **Deductions & Credits:** 11 Y/N questions: student loan interest; retirement contributions (IRA, 401(k)); HSA; education expenses; mortgage interest; real estate taxes; charitable contributions; medical/dental; child/dependent care; energy-efficient home improvements; other deductions.
4. **Income:** "types of income you received in 2026" (the year is hard-coded). 10 Y/N questions: W-2 wages; self-employment (1099-NEC/MISC); business ownership (Schedule C, S-Corp, Partnership, LLC); interest (1099-INT); dividends (1099-DIV); retirement (1099-R, SSA-1099); unemployment (1099-G); rental (Schedule E); alimony; other. Then "If yes, please describe".
5. **Business Information (if applicable):** Business Legal Structure radio (LLC, S Corporation, C Corporation, Sole Proprietorship, Other + specify); Business Legal Name; Business EIN; Business Address; "Is your business primarily selling?"* Goods (Products)/Services; "What kind of products or services do you sell?"*; **"+ Add Another Business"**, so one client can have several businesses.

The page closes with Comments / Additional Information (textarea), a note ("Your answers will help us determine which documents are required on the next page") and **Continue**.

### Step 2: Business Income & Expenses (`Annual Intake Business Income 2 .png`)
Every section is a currency grid with columns **Q1, Q2, Q3, Q4 and Total Annual**, plus an optional Description per row:
1. **Business Income:** Sales of Products; Services/Consulting; Rental Income; Investment Income; Subcontractor Income (1099); Refunds/Reimbursements; Other. Footer row "Total Business Income" (auto-sum per column).
2. **Wages, Payroll & Employment Taxes:** Total Wages Paid (W-2); Owner/Officer Compensation; Social Security Tax (FICA); Medicare; FUTA; SUTA; Other Payroll Taxes.
3. **Income Taxes Paid:** Federal Estimated (1040-ES/1120-ES); State Estimated ("e.g., GA Form 500 ES"); Other State; Local; Other.
4. **Business Expenses:** annual total only, in 2 columns, 25 categories: Advertising & Marketing, Bank Fees, Car & Truck, Contract Labor (1099), Depreciation & Amortization, Insurance, Legal & Professional, Meals & Entertainment ("client meals (50%)"), Office Expenses, Rent/Lease, Repairs & Maintenance, Software & Subscriptions, Telephone & Internet, Utilities, Travel, Dues & Memberships, Education & Training, Taxes & Licenses, Interest Expense, Equipment & Tools, Inventory/COGS, Supplies, Other. Total Business Expenses. The header mentions "You can also upload a detailed expense report", but this step has no upload box.

Buttons: Back / Continue. The step makes sense only when "Business" return type was selected, so it needs conditional skipping.

### Step 3: Required Document Upload (`Annual Intake From 3.png`)
- **Important box:** PDF/JPG/PNG; multiple files per item; max 10 MB per file; label correctly; all required docs must be uploaded *or* marked "I don't have this document" with an explanation.
- **Identity Verification Documents:** five upload tiles, each with "Click to upload or drag and drop (Upload as many as needed)", an **"I don't have this document" checkbox and a "Please explain why…" textarea**:
  - Your Government ID* (Driver's License, State ID, Passport)
  - Spouse Government ID (if applicable)
  - Your Social Security Card*
  - Spouse Social Security Card (if applicable)
  - Dependent(s) Qualifying Documents* (Birth Certificate, Adoption Papers)
- **Income Documents:** one multi-file drop zone plus an examples list (W-2, 1099-NEC, 1099-MISC, 1099-INT, 1099-DIV, 1099-R, K-1, SSA-1099, 1095-A, 1099-G, Rental Income (1099), Alimony, Other).
- **Deductions & Credits Documentation:** drop zone plus examples (1098, 1098-E, property taxes (1098), charitable receipts, medical, 1098-T, child care, energy, retirement contributions, HSA).
- **Business Income & Expenses Documentation:** drop zone plus examples (P&L, Balance Sheet, business 1099s, receipts, mileage log, bank statements, invoices, contracts, equipment purchases, payroll reports, quarterly tax payments). Starred note **"Required for Business Filings":** a categorized list of all business expenses, and a summary of year-to-date business income.
- **Business EIN & Formation Documents:** drop zone plus examples (CP 575, Articles of Organization, Incorporation docs, Operating Agreement, Business License).
- **Certification checkbox:** "Yes, I certify that I have uploaded all required documents and that the information provided is true and accurate… failure to provide the required documents may delay the preparation of my tax return."
- Back / Continue to Next Step.

### Step 4: Review & Sign Agreement (`Annual Tax Intake Form 4.png`)
- "Review Your Information" plus a global **Edit Information** button. Read-only cards, each with **Edit**:
  - Personal Information (Full Name, DOB, Email, Phone, SSN masked "•••-••-6789" with eye, Physical Address, **Occupation**)
  - Spouse Information
  - Dependents table (Name, DOB, Relationship, Other Details)
  - Filing Information (**Tax Year 2026**, Filing Status, Armed Forces, Legal Status, **Type of Work / Income Source** "Self-Employed, LLC", Additional Selections)
  - Income Documents and Deductions & Credits Documents tables (Document Name, File Name, Date Uploaded)
  - Business Information (structure, legal name, EIN, address, Primary Business Activity, Products/Services) with a Business Documents table
- **Payment choice, "How would you like to pay for your service?"** (radio):
  1. *I want to pay from my refund* (W-2 personal taxes only; "attracts an additional bank product fee")
  2. *I want to pay now with a 10% discount* ("Payment is due before preparation commences. Invoice will be sent to your email.")
  3. *I want to pay after preparation is completed* ("…your preparer will send you an email to pay the invoice before documents for review are emailed to you.")
- **Service Agreement:** a scroll box, "TAX PREPARATION SERVICE AGREEMENT – LVP Accounting & Taxes" (Agreement between Client and LVP; "1. Services – prepare your federal and state income tax returns…"). The text "You must scroll through the entire agreement to continue" implies a scroll-to-bottom gate. Checkbox "I have read and understand the Service Agreement in its entirety. I agree to the terms and conditions." **Signature (Type or Draw)*** with Clear, and **Date***.
- Back / **Submit Intake Form**.

### Success: `Success Tax Prep.png`
"Success! Your Form Has Been Successfully Submitted!" / "We're excited to support you with your tax preparation needs!" **What Happens Next?** A team member will review and reach out to schedule next steps, which may include: ✓ a free initial tax consultation, ✓ completing your tax preparation, ✓ gathering additional information if needed. Closes with "maximize your refund and stay tax ready!" Three tiles: Keep an Eye on Your Inbox (confirmation email with a copy of submission), Questions in the Meantime?, Thank You! Tagline "Your Goals. Our Expertise. A Brighter Tomorrow." The page has **no** account/portal mention, **no** payment link and **no** booking widget, only promises of outreach.

---

## 4. Quarterly Tax Intake Form ("File Business Quarterly Taxes")

**Step indicator:** 1 Business Information → 2 Taxes & Income / Income & Deductions → 3 Business Expenses → 4 Review and Sign / Documents / Review & Submit. Labels vary between screens (see §9).

### Step 1: Business Information (`business Information.png`)
Six panels:
1. **Business Information:** Business Legal Name*; DBA (if applicable); Business EIN* (XX-XXXXXXX); Business Phone*; Business Email*; Website; Business Address*; City*; State*; ZIP*.
2. **Business Structure & Ownership:** Business Structure (Select one)* radio (Sole Proprietorship, Partnership, S Corporation (S-Corp), C Corporation (C-Corp), LLC (Single Member), LLC (Multi-Member), Other (please specify)). "Are there business partners or owners?"* Y/N; if yes, owner details as free text ("John Smith – 50%…"). Primary Contact for Tax Matters (if different).
3. **Quarterly Tax Information:** "Which quarter(s) are you filing for?"* checkboxes Q1 (Jan–Mar)…Q4 (Oct–Dec). "First time filing quarterly?"* Y/N. "Did you pay any estimated taxes for the quarter(s)?"* Y/N; if yes, amounts and dates (textarea).
4. **Prior Year & Current Year Information:** "Have you filed business tax returns in the past?"* Y/N; if yes, last year's total income ($). Expected current-year income* ($). "Anticipate significant changes?"* Y/N; if yes, explain.
5. **Accounting & Recordkeeping:** software used; how you track income/expenses*; "Are your financial records up to date and organized?"* Yes / Somewhat / No / Need assistance.
6. **Additional Information:** multiple business locations?* Y/N; operate in multiple states?* Y/N; anything else.
Also: Business Industry & Services, "What type of product(s) or service(s)…?"*. Continue only, with no Back.

### Step 2: Taxes & Income (`Taxes & Income.png`), subtitled "Step 2 of 4 – Taxes & Income Information"
1. **Filing Period:** quarters checkboxes* (repeats step 1); business tax year*; start/end date of current tax year*; calendar year? Y / No (fiscal); fiscal start month.
2. **Estimated Federal Tax Payments:** Q1–Q4 rows with Amount Paid ($) and Date Paid.
3. **Business Income (Gross Receipts):** Q1–Q4 $. "Multiple income streams?"* Y/N, plus describe.
4. **Estimated State Tax Payments:** State dropdown, Q1–Q4 Amount and Date, **"+ Add Another State"** (repeating group).
5. **Estimated Payroll (Wages) per Quarter:** Q1–Q4 $.
6. **Estimated Payroll Taxes Paid:** grid of Social Security (6.2%), Medicare (1.45%), FUTA, SUTA and Other against Q1–Q4.
7. **Prior Year Information:** last-year total income*; last-year tax liability*; filed a business return last year?* Y/N; if yes, form (1120, 1120-S, 1065, Schedule C).
8. **Additional Tax Information** (textarea).
9. **Upload Supporting Documents for Business Income, Wages & Taxes:** a single drop zone with "Choose Files" (PDF, JPG, PNG, Excel XLS/XLSX; multiple). Note: label files with the quarter.
Back / Continue to Business Expenses.

### Step 3: Business Expenses (`Business Expenses.png`), "Step 3 of 4 – Business Expenses for Each Quarter"
Grid of 15 categories × Q1–Q4 ($), each with an icon and a hint: COGS, Office & Supplies, Rent/Lease, Utilities, Vehicle/Travel, Meals & Entertainment, Payroll & Contractor Payments, Professional Services, Marketing & Advertising, Insurance, Repairs & Maintenance, Taxes & Licenses, Interest, Depreciation, Other Deductions & Expenses. Total row "This will auto-calculate", with colour-coded quarter columns. Upload box for expense receipts (all quarters; PDF/JPG/PNG/XLS/XLSX); Additional Notes (Optional). Back / **Continue to Documents**. Step 4 is in fact the review page, not a separate documents step.

### Step 4: Review & Submit (`Review & Submit.png`), subtitled **"Step 3 of 3 – Review & Submit"** while the indicator shows step 4 of 4
- Cards with Edit:
  - Business Information (sample: Sunshine Cleaning LLC; Owner Name Octavia Johnson; Ownership 100%; Type of Business; Industry)
  - Income & Deductions (Filing Period, Tax Year, Calendar Year, Q1–Q4 Gross Income, streams, prior year)
  - Business Expenses (Q1–Q4 totals, Major Expense Categories, *plus* Estimated Federal/State tax paid, payroll, payroll taxes, "Credits / Withholding", which are misfiled under Expenses)
- **Uploaded Supporting Documents (Optional):** table with **File Name, Quarter, Document Type** (P&L, Bank Statement, Payroll Report, IRS Form 941, State Tax Payment), Date Uploaded. This implies each upload is tagged by quarter and document type.
- Upload Additional Supporting Documents (Optional) box.
- **Client Agreement:** "LVP Accounting and Taxes – Quarterly Tax Services Agreement" scroll box; "I certify that I have read and understand…"*; Full Name*; Title/Position (if applicable); Date*; **Signature (typed full name)***. There is no payment section.
- Back / Submit Intake Form. Goes to the generic success page (presumably; filename "all services except taxes").

---

## 5. Business Bookkeeping Intake Form

**Steps (each with a subtitle):** 1 Personal and Business Information (Tell us about you and your business) → 2 Business Background Details → 3 Document Upload → 4 Review & Sign Agreement.

### Step 1 (`Bookkeeping intake.png`)
- **1 Contact Information:** Full Name* (F/M/L); Title/Role*; Email*; Phone*; **Preferred Contact Method*** (Email / Phone / Text).
- **1 Business Information** (also numbered 1): Business Legal Name*; DBA; EIN*; Business Phone; Address*; Website; Business Industry*; Business Entity Type* (free text); Years in Business*.
- **2 Bookkeeping Package Selection** ("You can always upgrade later"). Three radio cards, **no prices shown**:
  - **Starter**: "Essential Bookkeeping. Solid Foundation." Monthly categorization, bank & card reconciliation, monthly P&L/Balance Sheet, email support.
  - **Growth** (badge *Most Popular*, preselected): everything in Starter + AP/AR tracking, monthly review calls, customized reports, email & phone support, quarterly tax readiness review.
  - **Premium** (*Most Comprehensive*): everything in Growth + payroll processing support, inventory tracking, monthly budgeting & forecasting, dedicated strategic advisor, priority support, year-end tax preparation support.
- **3 Additional Information:** Primary Bank(s)*; Accounting Software (if any); "Do you currently have a bookkeeper?"* Y/N; if yes, last day (date); current bookkeeping situation*; report frequency*; anything else.
- **4 Business Details:** goods/services*; business start date*; 1–3 year goals; other details.
- **5 Business Expenses & Assets:** "Common Business Expenses" checklist (~25 items incl. Other + specify). **Business Assets** repeating table: Asset Name/Description*, Date Purchased*, Purchase Price*, "Have you been depreciating this asset since it was placed in service?"* Y/N; "+ Add Another Asset".
- **6 System Access (if applicable):** repeating rows System/Platform, Username/Email, Notes; "+ Add Another System". Callout: **"For your security, please do not enter passwords on this form."** After submission the firm sends instructions for granting accountant access.
- **Save & Exit** / Continue to Business Background Details.

### Step 2: Business Background Details (`Bookkeeping Background intake.png`)
Eleven panels. Many yes/no questions are **free-text inputs with the placeholder "Please type yes or no"**, which is a design weakness; they should be radios.
1. **Bookkeeping Start & History:** start month/year*; need catch-up?*; from what date*; worked with another bookkeeper before? (+ reason)*.
2. **Business Accounts:** counts of checking*, savings, credit cards*, loans/LOCs*, merchant processors*; names of institutions*.
3. **How Customers Pay You:** methods*; AR exists?*; amount*; invoices tracked?*.
4. **Accounts Payable:** owe vendors?*; amount*; bills tracked?*; how vendors are paid*.
5. **Employees & Contractors:** W-2 count*; 1099 count*; payroll provider?*; which*; need payroll setup?*.
6. **Sales Tax:** collect?*; which states*; filing frequency*; current?*; need help?*.
7. **Inventory (Product-Based Businesses)**, highlighted in red: maintain inventory?*; manufacture/resell/both*; how tracked*; SKU count*; current list?*; checkbox **"I don't have my inventory organized yet. I need help setting up or organizing my inventory."**
8. **Loans & Financing:** any?*; lender + purpose*; balance*.
9. **Owner Activity & Other:** business funds used for personal?*; personal funds for business expenses needing reimbursement?*; explain*; anything else.
10. **Opening Balances & Reports:** current Balance Sheet & P&L?*; date*; if no, details*.
11. **Accounting Basis:** method (Cash/Accrual/Not Sure)*; reporting requirements (banks, investors)*; short and long-term goals*.
Back to Previous Step / Continue to Document Upload.

### Step 3: Document Upload (`Bookkeeping Document Upload intake .png`)
Accepted PDF/JPG/PNG, max 10 MB. "If a document is not available, you can skip it for now and provide it later" (this clashes with the asterisks).
- **Required:** Business Formation Document*; Business EIN Document* (CP 575); Last Year's Business Tax Return* (1120, 1120-S, 1065, Sched C).
- Additional Supporting Documents (Optional).
- Inventory Records (Product-Based Businesses Only), a conditional box.
- Additional Comments or Concerns textarea (0/1,000 counter).
- Back to Business Background Details / Continue to Review & Sign.

### Step 4: Review & Sign Agreement (`Bookkeeping Review  intake.png`)
1. Review Your Information: collapsible summaries (Personal and Business Information; Business Background Details) with Edit.
2. Review Uploaded Documents: each doc with filename, upload date, **View / Replace**.
3. Review & Confirm: three checkboxes (info accurate; uploaded docs or will provide on request; understand accuracy helps).
4. **"LVP ACCOUNTING & TAXES BOOKKEEPING SERVICES AGREEMENT"** scroll box (1. Services "as outlined in the selected package", 2. Client Responsibilities…). Checkbox agree*; **Full Name (Type your name to sign)***; **Title/Position***; **Date*** (prefilled 09/15/2026). Note: "By signing, you acknowledge…".
Back to Document Upload / Submit Intake Form.

---

## 6. Payroll Services Intake Form

**Steps:** 1 Business Details → 2 Payroll Details → 3 **Documents & Review** (on screen 1) / **Review & Sign Service Agreement** (on screens 2 and 3).

### Step 1 (`Payroll intake 1.png`)
- **Business Information:** Legal Business Name*; DBA; EIN*; **State of Formation***; Address*/City*/State*/ZIP*; Business Phone*; Business Email*; Website.
- **Business Type:** Industry*; primarily Product-based / Service-based / Both*; Brief description*.
- **Business Ownership:** Business Structure* (dropdown); "Are you the business owner?"* Y/N; **if No → "what is your role?"*** (dropdown); Primary Contact Name*, Phone*, Email*.
- **Payroll Service Needs:** start date*; current payroll situation* (multi: no system; manual/spreadsheets; switching provider; first-time setup; tax filing help; new-hire setup; year-end forms; Other + text).
- **Additional Information:** work with another payroll provider?* Y/N; reason (optional); **How did you hear about our payroll services?*** (dropdown).
- Exit Form / Continue to Step 2.

### Step 2 (`Payroll intake 2.png`)
- **Employee Information:** total employees*; FT; PT; contractors (1099); seasonal?* + details.
- **Payroll Schedule & Timing:** frequency* (dropdown); preferred pay day*; desired start date* (a duplicate of step 1); currently process payroll?*; last payroll date; caught up on prior payrolls?; special payrolls (bonus/commission)? + explain.
- **Current Payroll Setup:** use a payroll system?*; which* (dropdown) + other; transitioning from another provider?* (also asked in step 1); which provider; reason.
- **Payment & Tax Information:** "Who should fund the payroll?"* (dropdown); "How should payroll taxes be handled?"* (Include in payroll service / I will handle / Not sure yet); help registering for: Federal tax account (EIN), State tax account(s), SUI account, Workers' comp, Other.
- **Employee Pay & Deductions:** pay methods* (Direct deposit, Paper checks, Pay cards, Other); benefits/deductions (Health, Dental, Vision, Retirement, HSA, FSA, Garnishments, Other).
- **Additional Payroll Information:** multiple pay rates?*; time tracking?*; assistance with (New employee setup, Terminations/offboarding, Year-end forms, Payroll policy setup, Compliance support, Other); anything else.
- **Payroll Documents & Employee Information:** a single drop zone (PDF, Excel, Word, CSV). Examples include an **"Employee list (names, addresses, SSNs, pay rates)"**, which is sensitive PII for third parties.
- Back to Step 1 / Continue to Review & Sign Service Agreement.

### Step 3 (`Payroll Review intake.png`)
1. Review Your Information: five accordions (Business Details, Payroll Details, Payment & Tax Information, Employee Pay & Deductions, Additional Payroll Information) with Edit.
2. Review Uploaded Documents: table File Name / Date Uploaded / View · Replace; "+ Upload Additional Documents".
3. Additional Information (Optional) textarea, 0/1,000.
4. **Payroll Services Agreement** in an embedded **PDF viewer** (page 1/12, zoom, search, download).
5. **Confirm & Sign:** four required checkboxes: read agreement; information accurate; **authorize LVP to provide payroll services**; **agree to electronic communication**. Full Name*, Date* (prefilled), **Your Signature* (Type or draw, Clear)**.
Back to Step 2 / **Submit Form**.

---

## 7. Tax Planning Intake Form (4 steps)

**Steps:** 1 Client, Business & Tax Profile → 2 Income & Financial Information → 3 Planning Goals & Opportunities → 4 Review & Submit. Each screen has a different hero subtitle. Navigation is Previous / Next Step / **Save and Continue Later**.

### Step 1 (`Tax Planning intake 1.png`)
- **Client & Contact Information:** Full Name* (single field), Phone*, Email*; "Are you seeking tax planning for?"* Individual (Personal) / Business / Both. These are drawn as checkboxes but behave as single-choice.
- **Business Information (If Applicable)**, "you can skip to the next section": Business Legal Name, DBA, EIN; **Business Structure***, **Industry***, Years in Business; **State(s) Where Your Business Operates*** (multi); Number of Owners/Employees/1099 Contractors (dropdown ranges). Fields are marked required inside an optional section, so they need conditional-required logic.
- **Accounting & Tax Information:** Accounting Method*; Tax Year*; bookkeeper/accountant?* Yes / No / I had one previously.
- **Tax Planning Details:** services* (multi, with a "Select All or Most" shortcut): Individual, Business, Entity structure review, S-Corp election, Owner compensation, Retirement plan strategies (SEP, Solo 401(k), 401(k)), Investment & wealth-building, Real estate & rental, Multi-state, Estate & succession, Tax credit & incentive, International, General strategy, Other. **Primary reason*** (multi): reduce liability, business growth, estimated payments, entity options, retirement, major purchase, business sale/succession, cash flow, not sure, Other.

### Step 2 (`Tax  planning intake  2 .png`)
1. **Personal Income** ($): W-2; self-employment/1099; investment; rental; retirement; other. Also: multiple states?* + list; current filing status (dropdown); tax year of most recent return; expected changes (text).
2. **Business Financial** ($): annual revenue; net profit before owner comp; owner compensation; total payroll; major expenses. Planned major purchases? Yes/No/Not Sure + describe; other income streams/entities.
3. **Current Tax Information:** filed most recent return?* Yes/No/Not Yet; tax year; ($) prior-year total liability, refund/owed, current federal withholding, state withholding, federal estimated YTD, state estimated YTD. Notices/audits/unresolved issues?* + explain; major changes in last 3 years? + explain; working with a tax professional?* Yes/No/Had one previously + name.
4. **Additional Financial Details (Optional):** upcoming significant expenses? + describe; anything else.
There are **no document uploads** anywhere in Tax Planning.

### Step 3 (`Tax Planning intake 3 .png`)
1. **Tax Planning Goals** (21 checkboxes + Other).
2. **Upcoming Changes** (13 life events + Other), with a side note "Life changes. So do tax opportunities."
3. **Specific Tax Concerns** (owe back taxes, IRS notice, underestimated, quarterly help, record keeping, deductions, structure, retirement, multi-state, real estate, crypto, Other) and a "Have a specific question?" textarea.
4. **Long-Term Vision:** short-term (1–2 yrs), long-term (3–5+ yrs), anything else.

### Step 4 (`Tax planning intake 4.png`)
- Accordions (1 Client & Business Profile, 2 Income & Financial Information, 3 Planning Goals & Opportunities) with Edit and **Edit All Sections**.
- **Tax Planning Service Agreement (Summary)** in a scroll box, plus **View/Download Full Agreement**. Bullets: no guaranteed outcome; standard terms, fees, engagement policies; Privacy Policy.
- **Six required checkboxes:** Terms of Service (link); info accurate; no guaranteed outcome; authorize use of info; confidentiality per Privacy Policy (link); **consent to be contacted by phone, email or text**.
- **Your Signature:** typed signature, Date*, Full Legal Name*, **Email Address (for confirmation)***.
- Previous / Submit Intake Form; "Your information is secure and confidential."

---

## 8. Business Development Intake Form (4 steps)

**Steps:** 1 Your Information & Services → 2 Business Details → 3 Additional Information → 4 Review & Submit. Completed steps show a check mark on screen 2. Navigation is Previous / Next Step / Save and Continue Later.

### Step 1 (`Development intake 1.png`)
- Full Name*, Phone*, Email*, Business Name (if applicable), Business Address (if applicable), City, State, ZIP.
- **Business Development Services** (multi-select cards): Business Formation; EIN Registration; **Georgia Registered Agent**; Nationwide Registered Agent Services; Business Plan Creation; Operating Agreement Creation; Logo Creation; Website Development; Product Development & Manufacturing Assistance; Service Development & Packaging; Budgeting & Investment Planning; Business Resource Support.
- How Did You Hear About Us? (dropdown); Additional Notes.

### Step 2 (`Development intake 2 .png`)
1. **Business Overview:** current status* (starting new / registered / expanding / rebranding); type of business* (Sole Prop, Partnership, LLC, S-Corp, C-Corp, Nonprofit, Franchise, Other); "What is your business name?"* **and** "Do you already have a business name in mind?"* Y/N + Business Name (a redundant pair).
2. **Accounting & Financial Structure:** method* (Calendar / Fiscal / Not sure) + Fiscal start month; software?* (Yes/No/Not yet/Need help choosing); bookkeeper?* (Yes/No/Not yet/Need a recommendation).
3. **About Your Business:** products/services*; target market*; what makes it unique*; 1–3 year vision*.
4. **Location & Registered Agent:** primary state*; other states needing registered agent (multi).
5. **Branding & Design Preferences (If Applicable):** logo colours; why.
6. **Additional Information.**

### Step 3 (`Development intake 3.png`)
1. Goals & Timeline: main goals*; when to begin* (dropdown); 3–5 year vision*.
2. Current Stage & Needs: stage*; biggest challenges (multi, 12 + Other).
3. Additional Details: **How did you hear about LVP?*** (a duplicate of step 1); questions/requests.
4. **Document Uploads (Optional):** PDF, DOC, DOCX, JPG, PNG, 10 MB; examples are business plan, operating agreement, brand guidelines, product images, website content.

### Step 4 (`Development Intake 4.png`)
- Review cards with Edit: Personal & Business Information; Selected Services (checked list); Business Details (incl. Website, Logo Preferences, Fiscal Year Start, Additional Registered Agent States); Additional Information; Uploaded Documents (name + size).
- **"LVP Accounting & Taxes – Business Development Service Agreement"** inline with 7 clauses: Services, Client Responsibilities, **Fees ("provided in a separate agreement or proposal")**, Confidentiality, No Legal or Investment Advice, Termination, Agreement. View/Download link.
- Checkbox agree*; Client Signature (typed); Date*; Full Legal Name*; Email (for confirmation)*.
- Previous / Submit Form.

### Generic success (`Success Page for all services except taxes.png`)
"Success! Your Form Has Been Successfully Submitted!" **What Happens Next?** (1) We'll Review Your Information → (2) **Your Assigned Specialist Will Reach Out** → (3) Let's Move Forward Together. Tiles: Check Your Inbox (confirmation email with copy), Need Assistance?, Thank You! Tagline "Small Business. Big Possibilities." It has **no** account creation, payment or scheduling step.

---

## 9. Branding, layout, typos and inconsistencies

**Branding and layout**
- **Palette:** navy (#0B1F4B-ish, headings, footer, dark buttons) and orange (#F07A1A-ish, accents, primary CTAs, active step), on white or cream panels with light-blue info boxes.
- **Type:** serif display headings (Playfair/DM Serif-like), sans body, script accents ("Plan | Prepare | Prosper", "Almost There!", "Your Success Our Support").
- **Logo:** bar-chart "LVP" over ACCOUNTING / AND TAXES.
- **Taglines:** "Plan | Prepare | Prosper"; "People. Purpose. Prosperity."; "For a Stronger Tomorrow".
- **Imagery:** photo heroes with mugs and books carrying slogans.
- **Layout pattern:** numbered navy circular badges per section, a horizontal 3–4 step progress bar, two or three-column card grids, and a navy footer with phone, email, website, socials and "Secure. Confidential. Always."

**Placeholder contact data:** phone **(470) 555-1234** (a fictional 555 number), info@LVPAccounting.com, www.LVPAccounting.com. The real firm details must be configured.

**Step indicator and label inconsistencies**
- **Annual Tax:**
  - Step 1 is labelled "Personal & Filing Information" vs "Personal and Filing Information".
  - Step 4 is labelled "Review & Sign Agreement" vs "Review & Sign Service Agreement" vs "Review and Sign Agreement".
  - The file name has the typo "Annual Intake **From** 3".
  - One section badge is the number "3" while the others are icons.
- **Quarterly:**
  - Step 2 is labelled "Taxes and Income" / "Taxes & Income" / "Income & Deductions".
  - Step 4 is labelled "Review and Sign" / "Documents" / "Review & Submit".
  - The subtitle "Step 2 of 4"/"Step 3 of 4" sits next to **"Step 3 of 3"** on the review page.
  - "Business **Expensss**" is misspelled.
  - The Filing Period prompt is garbled: "Which you filing and your tax year?".
  - "Continue to Documents" leads to the review page.
- **Payroll:** step 3 is labelled "Documents & Review" vs "Review & Sign Service Agreement", and the uploads actually sit on step 2.
- **Bookkeeping:**
  - Two sections are both numbered "1".
  - Required uploads (*) contradict "you can skip it for now".
  - Yes/no questions are free text.
- **Tax Planning and Business Development:** yes/no and single-choice answers are drawn as checkboxes.

**Other wording and data errors**
- The "4 Simple Steps" on the entry page (Business Information / Additional Details / Upload / Review) match none of the flows exactly.
- Placeholder typo "you@**exemple**.com" (Annual step 1).
- Logo text variants: "AND TAXESTAX" (rendering glitch), "AND-TAXES", "& TAXES".
- Tagline typo "FOR A STRONGER **TOMGROW**" (generic success page).
- "Same Goals Bigger Possibilities!" (entry page) vs "Small Business. Big Possibilities." elsewhere, probably meant to match.
- Payroll mug "BUSINESS" vs "BUSINESSES".
- BD step 2 "Tell us about your business and **d** your goals".
- **Review pages show fields the forms never collected:**
  - Annual review: Occupation (primary), Tax Year, "Type of Work / Income Source", "Primary Business Activity".
  - Quarterly review: Owner Name, Ownership %, Type of Business.
  - BD review: Website, Fiscal Year Start "January" with Calendar Year selected, "Bookkeeping Needs".
- **Mismatched horizons:** BD step 2 asks for a 1–3 year vision and step 3 a 3–5 year vision. Quarterly review puts tax payments under "Business Expenses".
- **Duplicate questions:**
  - Quarterly quarter selection and prior-year filing (asked on steps 1 and 2)
  - Payroll start date and current provider (steps 1 and 2)
  - BD "how did you hear" (steps 1 and 3) and business-name pair
- **Hard-coded years:** "2026" in the Annual income prompt and the entry card.
- **Sample-data dates:** files dated 09/10/2026, 09/13/2026, 09/15/2026 and 10/15/2026, mixed with 2024 and 2025 file names.
- **Signature styles vary:** type-or-draw (Annual, Payroll), typed only (Quarterly, Bookkeeping, Tax Planning, BD). Title/Position is required in Bookkeeping, optional in Quarterly, and absent elsewhere.
- **Payment step:** only Annual Tax has one. Bookkeeping packages carry no prices. BD says fees come in a separate proposal.

---

## 10. Implications for the system

1. **Public, unauthenticated intake per tenant.** Begin Online is a public, firm-branded page at a URL like `{firm}/begin` with a service picker. The forms must work without login. Firmivra needs tenant-scoped public form routes with the firm's branding tokens (logo, colours, contact info, taglines) and CAPTCHA/rate limiting. Encryption at rest is required for SSNs, IDs and SS cards; both PII and uploads arrive from anonymous users.
2. **A configurable form engine, not hard-coded forms.** Six multi-step forms share primitives:
   - stepper with configurable labels; sections; required flags
   - field types: text, textarea with counter, email, phone, date, masked SSN/EIN, state select, radio, checkbox group with "Other + specify", "Select all" shortcut, currency
   - **quarterly currency grids with auto-sum totals** (rows × Q1–Q4 × Total)
   - **repeating groups** (dependents, businesses, owners, states, assets, system logins)
   - **conditional visibility and conditional required** (if Yes → details; spouse if MFJ; business step only if business return; inventory only if product-based; "If no, your role")
   - read-only review rendering with per-section Edit
   
   Store form definitions as versioned schemas per firm per service, and save each submission with the schema version used.
3. **Document requests inside the intake.** Upload slots fall into two kinds: named required slots (Gov ID, SS card, EIN letter, formation docs, last year's return) and category drop zones. Slots need multi-file support, a type/size policy (PDF/JPG/PNG, sometimes XLS/XLSX/DOC/CSV; 10 MB), **"I don't have this document" + reason**, "provide later", tags (quarter, document type), and View/Replace before submit. Required-document lists should derive from answers ("answers determine which documents are required on the next page"). Outstanding items should become follow-up document requests in the portal.
4. **Drafts and resume.** "Save and Continue Later", "Save & Exit" and "Exit Form" need server-side drafts keyed to an email with a magic-link resume. Without an account this is the only option. Drafts should expire, and reminder emails should be considered.
5. **E-signature and consent capture.** Store agreement version and text hash, scroll-to-end gating, each consent checkbox (Terms, Privacy, no-guarantee, authorization, **electronic communication / phone-email-text contact consent**), typed or drawn signature image, name, title, date, plus IP, user agent and timestamp for an audit trail. Agreements are per service and per firm, editable by the firm, and can be a full PDF (12 pages for payroll) or summary + download. A signed PDF copy should go into the client's documents.
6. **Payment preference (Annual Tax only).** Capture a billing option (pay from refund / prepay at 10% discount / pay after preparation) on the engagement. Each option leads somewhere different: refund transfer with a bank-product fee, an immediate invoice, or invoicing gated before the return is delivered for review. Other services need packages/pricing (Bookkeeping Starter/Growth/Premium) or proposals (BD) handled after intake.
7. **What submission should create.** The screens never promise an account, so the intended behaviour is review first:
   - **Create (or match by email/EIN/SSN) a pending Lead/Prospect client** in a firm-review queue, with any spouse, dependents and business entities attached as related records.
   - **Create a pending Engagement/Service Request** per submission (service type, tax year or quarters, package, payment choice, signed agreement, documents), assigned to a specialist ("Your Assigned Specialist Will Reach Out").
   - **Send a confirmation email with a copy of the submission** (both success pages), and notify firm staff.
   - **On firm approval:** convert to an active client, **invite them to the Client Portal** (create the account then), and move uploaded documents and outstanding document requests into the portal. Scheduling (the "free initial tax consultation") is a follow-up action or a booking link sent by staff.
   - **Dedupe:** returning clients who use Begin Online must match existing records rather than duplicate them. Consider offering "Already a client? Sign in to Client Portal" at the start.
8. **Data model hints.**
   - **Person** (name, DOB, SSN, contact, preferred contact method, legal status, military): spouse and dependents as related persons with relationship and flags.
   - **Business entity** (legal name, DBA, EIN, structure, state of formation, address, industry, years, owners with %, multi-state, registered-agent states).
   - **Engagement** (service, period/tax year/quarters, package, status, billing option, assigned staff).
   - **Intake submission** (schema version, JSON answers, timestamps).
   - **Financial snapshots** (quarterly income/expense/payroll-tax/estimated-payment tables).
   - **Document** (slot, category, quarter, type, status: uploaded / not available + reason / pending).
   - **Signature/consent records**, and **referral source** ("How did you hear").
   - **System-access notes** (no passwords; follow-up secure credential sharing).
9. **Fix-before-build items for the client.** Agree on canonical step labels and counts, replace the 555 phone number, align review-page fields with what the forms actually collect, convert yes/no text fields to radios, remove the duplicate questions, decide whether Tax Planning needs uploads, and confirm whether intake should ever auto-create a portal account. The mockups imply that it should not.
