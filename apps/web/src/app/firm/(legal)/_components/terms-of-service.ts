import type { LegalDocumentText } from './legal-document';

/**
 * Firmivra's Terms of Service, word for word from `docs/specs/Firmivra_Terms_of_Service.docx`.
 * Left out: the publication note, the bracketed contact and venue fields (the page fills them
 * from lib/company.ts), the providers not yet named, and the drafting appendices. Change the
 * text in the docx first, then here.
 */
export const TERMS_OF_SERVICE: LegalDocumentText = {
  title: 'Terms of Service',
  subtitle:
    'Terms Governing Firmivra Websites, Firm Workspaces, Client Portals, Software, and Related Services',
  effective: 'October 2, 2026',
  updated: 'October 2, 2026',
  sections: [
    {
      id: 'agreement-to-these-terms',
      title: '1. Agreement to These Terms',
      blocks: [
        {
          kind: 'paragraph',
          text: 'These Terms of Service ("Terms") govern access to and use of the Firmivra websites, applications, Super Admin area, Firm Workspaces, client portals, integrations, calculators, communications, and related software and services (collectively, the "Services"). By creating an account, accepting an Order Form, clicking to accept these Terms, accessing a client portal, or otherwise using the Services, you agree to be bound by these Terms and any applicable Order Form, Data Processing Addendum ("DPA"), Business Account Agreement, acceptable-use rules, privacy notice, and other incorporated policies.',
        },
        {
          kind: 'paragraph',
          text: 'If you use the Services on behalf of a company, firm, organization, or other legal entity, you represent that you have authority to bind that entity, and "you" includes that entity. If you are a Client Portal User, your Firm may also have separate engagement terms, privacy notices, professional obligations, and service agreements that apply to your relationship with that Firm.',
        },
      ],
    },
    {
      id: 'definitions',
      title: '2. Definitions',
      blocks: [
        {
          kind: 'table',
          head: ['Term', 'Meaning'],
          rows: [
            [
              'Firmivra',
              'The Firmivra platform and the legal entity that operates it, as identified on the Firmivra Legal page or applicable Order Form.',
            ],
            [
              'Firm Customer / Firm',
              'A tax, accounting, bookkeeping, payroll, advisory, legal/financial, or other professional organization that subscribes to or uses the Firm Workspace.',
            ],
            [
              'Authorized User',
              'A Firm Customer administrator, owner, employee, contractor, or staff user authorized to access the Firm Workspace.',
            ],
            [
              'Client Portal User',
              "An individual or authorized business user who accesses a Firm Customer's client portal.",
            ],
            [
              'Customer Data',
              'Data, documents, content, messages, records, forms, tax/financial information, client information, and other materials submitted to or processed through the Services by or for a Firm Customer.',
            ],
            [
              'Order Form',
              'An online order, subscription plan, signed proposal, statement of work, or other ordering document specifying commercial terms.',
            ],
            [
              'Third-Party Service',
              'A service, integration, website, platform, processor, or provider not owned by Firmivra, including AWS, payment processors, email/SMS, calendar, e-signature, and other integrations.',
            ],
          ],
        },
      ],
    },
    {
      id: 'eligibility-and-authority',
      title: '3. Eligibility and Authority',
      blocks: [
        {
          kind: 'paragraph',
          text: "Firm Workspace accounts are intended for legally capable adults and authorized business users. Client Portal accounts are intended for adults or authorized representatives permitted by the Firm Customer. You must provide accurate information and must not create an account using another person's identity or without authorization. Users under 18 may not create an independent Firmivra business account. The Services are not directed to children under 13.",
        },
      ],
    },
    {
      id: 'account-registration-verification-and-security',
      title: '4. Account Registration, Verification, and Security',
      blocks: [
        {
          kind: 'list',
          items: [
            'You must provide accurate, current, and complete registration information and keep it updated.',
            "You are responsible for maintaining the confidentiality of login credentials and for all activity under your account, except to the extent caused by Firmivra's breach of its obligations.",
            'You must promptly notify Firmivra of suspected unauthorized access, compromised credentials, or misuse.',
            'Firmivra may require email, phone, MFA, identity, or business verification and may refuse, suspend, or restrict access until verification is complete.',
            'Firm Customers are responsible for promptly disabling departed staff, assigning appropriate roles, reviewing permissions, and preventing credential sharing.',
            'Client Portal access is limited to the authenticated client/business relationship and permitted records. Users may not attempt to access another client, Firm, tenant, or restricted module.',
          ],
        },
      ],
    },
    {
      id: 'firm-application-approval-and-activation',
      title: '5. Firm Application, Approval, and Activation',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A Firm may be required to submit a business application, professional credentials, supporting documents, certifications, and agreements before its Firm Workspace is activated. Submission does not guarantee approval or immediate access. Firmivra may review, verify, approve, reject, place on hold, or request additional information consistent with applicable law and the applicable program rules.',
        },
        {
          kind: 'paragraph',
          text: 'Approval may create or activate the Firm tenant/workspace, activate the primary Firm administrator, and enable Firm login/access. Firmivra may suspend or revoke activation if application information is materially inaccurate, fraudulent, expired, unauthorized, or inconsistent with applicable requirements.',
        },
      ],
    },
    {
      id: 'license-and-right-to-use-the-services',
      title: '6. License and Right to Use the Services',
      blocks: [
        {
          kind: 'paragraph',
          text: "Subject to these Terms and payment of applicable fees, Firmivra grants the Firm Customer a limited, non-exclusive, non-transferable, non-sublicensable right during the subscription term to access and use the Services for the Firm Customer's internal business operations and authorized client-service activities. Client Portal Users receive a limited right to access their Firm's portal for authorized personal/business purposes.",
        },
        {
          kind: 'paragraph',
          text: 'No right is granted to copy, sell, resell, sublicense, publish, distribute, rent, lease, timeshare, reverse engineer, create derivative works of, or commercially exploit the Services except as expressly permitted in writing or by applicable law that cannot be waived.',
        },
      ],
    },
    {
      id: 'firm-customer-responsibilities',
      title: '7. Firm Customer Responsibilities',
      blocks: [
        {
          kind: 'list',
          items: [
            'Use the Services only for lawful professional/business purposes and in compliance with applicable tax, privacy, security, employment, consumer-protection, professional, and industry obligations.',
            'Provide all legally required client notices, obtain consents/authorizations, and determine lawful bases for processing Customer Data.',
            'Configure staff permissions, client visibility, integrations, retention settings, forms, reminders, payment settings, and portal modules appropriately.',
            'Ensure the accuracy of professional, tax, accounting, payroll, bookkeeping, advisory, and client data entered into the Services.',
            'Review outputs, calculations, workflows, templates, reminders, automations, and documents before relying on them for professional services.',
            "Back up or export critical records where required by the Firm's own professional/legal obligations and follow retention requirements.",
            'Not instruct Firmivra to process information in a manner that violates law, professional duties, contractual obligations, or third-party rights.',
          ],
        },
      ],
    },
    {
      id: 'client-portal-users',
      title: '8. Client Portal Users',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Client Portal Users may access only modules and records enabled by the Firm Customer, their account type, active services, and record-level permissions. A Personal/Individual account does not automatically receive access to business-only portal areas. A Business account does not automatically receive access to unrelated personal records. Firmivra enforces technical access controls, but the Firm Customer is responsible for correct account classification, relationship mapping, and record visibility.',
        },
        {
          kind: 'paragraph',
          text: 'Client Portal Users must not use the portal as general-purpose cloud storage. Document uploads may be limited to active tax/business services, assigned forms, document requests, or other approved workflows. Firmivra or the Firm Customer may block uploads when no eligible service/request exists.',
        },
      ],
    },
    {
      id: 'acceptable-use',
      title: '9. Acceptable Use',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You may not, and may not permit another person to:',
        },
        {
          kind: 'list',
          items: [
            'Use the Services for unlawful, fraudulent, deceptive, abusive, harassing, discriminatory, or infringing activity.',
            'Upload malware, ransomware, malicious code, or files designed to damage or compromise systems.',
            'Attempt to bypass authentication, tenant/client isolation, role permissions, rate limits, audit controls, or security restrictions.',
            "Probe, scan, penetration-test, or exploit the Services without Firmivra's written authorization, except through an approved vulnerability-disclosure program if one exists.",
            'Reverse engineer, decompile, disassemble, scrape, harvest, or systematically extract the Services or data except where applicable law expressly permits it.',
            'Use the Services to send spam or unlawful marketing communications or to violate communication-consent rules.',
            'Upload or disclose information you do not have authority to process.',
            'Use the Services to provide or store data subject to a special legal regime that Firmivra has not agreed to support (for example, regulated health information requiring a BAA) unless a separate written agreement authorizes it.',
            'Use outputs, calculators, AI/automation features, or templates as a substitute for required professional judgment or legal review.',
          ],
        },
      ],
    },
    {
      id: 'customer-data-ownership-and-license',
      title: '10. Customer Data Ownership and License',
      blocks: [
        {
          kind: 'paragraph',
          text: "As between Firmivra and the Firm Customer, the Firm Customer retains its rights in Customer Data. Firmivra does not acquire ownership of Customer Data. The Firm Customer grants Firmivra a limited right to host, copy, transmit, organize, display, back up, secure, and otherwise process Customer Data solely as necessary to provide, support, protect, maintain, improve, and legally operate the Services in accordance with these Terms, the DPA, the Privacy Policy, and the Firm Customer's instructions.",
        },
        {
          kind: 'paragraph',
          text: "Client Portal Users retain any rights they have in content they provide, subject to the Firm Customer's legal/professional retention obligations and Firmivra's limited processing rights as described above.",
        },
      ],
    },
    {
      id: 'privacy-and-data-processing',
      title: '11. Privacy and Data Processing',
      blocks: [
        {
          kind: 'paragraph',
          text: "Firmivra's Privacy Policy describes Firmivra's processing when Firmivra acts for its own purposes. When Firmivra processes Client Data on behalf of a Firm Customer, the DPA and Firm Customer instructions govern the processing. If GDPR/UK GDPR or similar laws apply, the parties will allocate controller/processor responsibilities in the DPA and use required transfer mechanisms.",
        },
      ],
    },
    {
      id: 'confidentiality',
      title: '12. Confidentiality',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Each party may receive non-public confidential information from the other. The receiving party will use confidential information only to perform or receive the Services, protect it using reasonable care, and disclose it only to personnel, contractors, advisers, or service providers who need to know it and are subject to confidentiality obligations, or as required by law. Customer Data and non-public security information are Confidential Information.',
        },
      ],
    },
    {
      id: 'tax-return-information-and-irc-section-7216',
      title: '13. Tax Return Information and IRC Section 7216',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firm Customers that are tax return preparers are responsible for compliance with IRC Section 7216, Section 6713, Treasury Regulations, required taxpayer consents, and applicable exceptions. Firmivra will process tax return information to provide the Services and will not intentionally use or disclose it for unrelated purposes except as authorized by the Firm Customer and legally permitted or required. The Firm Customer represents that instructions it gives Firmivra regarding tax return information are lawful.',
        },
      ],
    },
    {
      id: 'glba-safeguards-rule-and-security-responsibilities',
      title: '14. GLBA / Safeguards Rule and Security Responsibilities',
      blocks: [
        {
          kind: 'paragraph',
          text: "Firm Customers may be financial institutions or service providers subject to GLBA, the FTC Safeguards Rule, IRS guidance, state security laws, or professional standards. Firmivra maintains security measures appropriate to the Services and may support Firm Customer compliance, but does not assume the Firm Customer's independent legal duties. Firm Customers remain responsible for their WISP, employee training, endpoint/device security, risk assessments, access governance, incident procedures, and other obligations that apply to their businesses.",
        },
      ],
    },
    {
      id: 'aws-hosting-and-third-party-infrastructure',
      title: '15. AWS Hosting and Third-Party Infrastructure',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra uses Amazon Web Services (AWS) for cloud hosting and related infrastructure. Firmivra selects and configures AWS services under a shared-responsibility model and may use AWS compute, storage, database, backup, logging, security, networking, and related services. AWS contractual/data-processing terms may apply to Customer Data processed through AWS.',
        },
        {
          kind: 'paragraph',
          text: 'The Services may also depend on additional third-party providers for payments, email/SMS, calendar/video meetings, e-signatures, identity verification, monitoring, tax/financial integrations, support, and related functions. Firmivra may add, remove, or replace providers as the Services evolve, subject to applicable notice/contract requirements.',
        },
      ],
    },
    {
      id: 'third-party-integrations',
      title: '16. Third-Party Integrations',
      blocks: [
        {
          kind: 'paragraph',
          text: "If you enable a third-party integration, you authorize Firmivra to exchange the data reasonably necessary to provide that integration. Third-party services are governed by their own terms and privacy policies. Firmivra is not responsible for a third party's independent services, outages, data practices, or changes, except to the extent Firmivra is legally responsible for its selection or management of a processor/subprocessor.",
        },
      ],
    },
    {
      id: 'payments-between-firms-and-clients',
      title: '17. Payments Between Firms and Clients',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra may enable Firms to invoice clients and accept payments using third-party payment processors. Unless expressly stated otherwise, Firmivra is a software provider and not a bank, escrow agent, trustee, fiduciary, or money transmitter for the underlying Firm-client relationship. Payment processors may impose additional terms, underwriting, verification, reserves, chargeback, refund, and settlement rules.',
        },
        {
          kind: 'paragraph',
          text: 'Firmivra should not be used to transmit raw payment-card security codes or other prohibited card data through ordinary messages, notes, or form fields. Payment status in Firmivra must reflect confirmed processor/canonical payment events rather than user clicks alone.',
        },
      ],
    },
    {
      id: 'fees-billing-subscriptions-and-taxes',
      title: '18. Fees, Billing, Subscriptions, and Taxes',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firm subscription fees, billing frequency, usage limits, plan features, renewal terms, minimum commitments, and other commercial terms are stated in the applicable Order Form, subscription page, or Business Account Agreement. Unless the applicable Order Form states otherwise, fees are non-refundable except where required by law or expressly stated in writing.',
        },
        {
          kind: 'paragraph',
          text: "If a subscription renews automatically, Firmivra will apply the renewal terms disclosed at purchase/contracting and any legally required cancellation or renewal notices. Customers are responsible for applicable taxes, duties, and governmental charges other than taxes based on Firmivra's net income. Late/nonpayment may result in suspension after any applicable notice/cure period.",
        },
      ],
    },
    {
      id: 'client-payments-refunds-and-disputes',
      title: '19. Client Payments, Refunds, and Disputes',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A Firm Customer is responsible for its invoices, pricing, refunds, cancellations, client-payment disputes, tax treatment, and legal obligations to its clients. Firmivra provides the software workflow and may facilitate processor actions. Firmivra does not guarantee that a client payment will settle, remain undisputed, or be free from chargeback/reversal. Refunds or voids must be processed through the approved workflow/provider and remain linked to the original invoice/payment history.',
        },
      ],
    },
    {
      id: 'recurring-services-and-customer-cancellation',
      title: '20. Recurring Services and Customer Cancellation',
      blocks: [
        {
          kind: 'paragraph',
          text: "Recurring Firmivra subscription cancellation is governed by the applicable Order Form/Business Account Agreement. A Firm Customer's own recurring services to its clients are governed by the Firm's agreements and policies. Deactivating a Firmivra client portal account does not automatically cancel an underlying professional service or recurring billing arrangement unless the applicable Firm has expressly configured and legally authorized that behavior.",
        },
      ],
    },
    {
      id: 'beta-preview-and-experimental-features',
      title: '21. Beta, Preview, and Experimental Features',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra may identify features as beta, preview, pilot, experimental, early access, or similar. Such features may be incomplete, change materially, contain errors, have limited support, or be discontinued. Unless a separate agreement states otherwise, beta features are provided "as is," may not be appropriate for production or regulated workflows, and are excluded from any service-level commitment. Customers must independently evaluate whether a beta feature is suitable for their use.',
        },
      ],
    },
    {
      id: 'calculators-templates-automations-and-informational-resources',
      title: '22. Calculators, Templates, Automations, and Informational Resources',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Calculators, tax estimators, templates, checklists, business-resource pages, external links, reminders, workflow automations, and similar tools are provided for convenience and operational support. They are not legal, tax, accounting, investment, payroll, employment, or financial advice and do not replace professional judgment or independent verification. Results may depend on user-entered data, configuration, laws, rates, and assumptions that may change.',
        },
      ],
    },
    {
      id: 'professional-responsibility-and-no-professional-advice-by-firmivra',
      title: '23. Professional Responsibility and No Professional Advice by Firmivra',
      blocks: [
        {
          kind: 'paragraph',
          text: "Firmivra is a software provider. Firmivra does not prepare tax returns, provide legal advice, act as a CPA/EA/attorney/financial adviser, make filing elections, determine tax positions, provide investment advice, or establish a professional-client relationship with a Firm Customer's clients merely by providing the Services. Firm Customers remain solely responsible for their professional services, advice, filings, calculations, deadlines, engagement terms, and client communications.",
        },
      ],
    },
    {
      id: 'electronic-communications-and-e-signatures',
      title: '24. Electronic Communications and E-Signatures',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You consent to receive electronic communications related to the Services, including account, security, transactional, service, billing, and legal notices, subject to applicable law and communication preferences. If Firmivra offers electronic-signature features, the applicable signature provider/process and transaction-specific consent requirements will govern. Firm Customers are responsible for determining whether an electronic signature is legally sufficient for a particular document or jurisdiction.',
        },
      ],
    },
    {
      id: 'service-availability-maintenance-and-changes',
      title: '25. Service Availability, Maintenance, and Changes',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra may perform maintenance, updates, security work, migrations, and feature changes. The Services may be unavailable due to planned maintenance, emergencies, internet/provider failures, third-party outages, force majeure, or other causes. Unless an Order Form includes a specific service-level agreement, Firmivra does not guarantee uninterrupted or error-free availability. Firmivra may modify or discontinue features, provided it will use commercially reasonable efforts to avoid materially reducing core paid functionality without notice where contractually required.',
        },
      ],
    },
    {
      id: 'security-and-customer-security-duties',
      title: '26. Security and Customer Security Duties',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra implements security measures designed to protect the Services, but security is a shared responsibility. Customers and users must use strong passwords/MFA where available, protect credentials and devices, review staff roles, disable former users, configure integrations securely, avoid sharing sensitive data through inappropriate fields, and promptly report suspected incidents. You may not rely on Firmivra as your sole backup, legal record-retention system, or security program unless a separate agreement expressly says otherwise.',
        },
      ],
    },
    {
      id: 'data-export-return-retention-and-deletion',
      title: '27. Data Export, Return, Retention, and Deletion',
      blocks: [
        {
          kind: 'paragraph',
          text: 'During an active subscription, Firm Customers may access or export Customer Data using available features and subject to permissions. Following termination, Firmivra may provide a limited export/retrieval period if stated in the Order Form, DPA, or product notice. After applicable retention periods, Firmivra may delete or de-identify Customer Data unless retention is required by law, contract, backup processes, disputes, security, or professional/regulatory obligations. Termination or portal deactivation does not require Firmivra to delete records that must lawfully be retained.',
        },
      ],
    },
    {
      id: 'intellectual-property',
      title: '28. Intellectual Property',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra and its licensors retain all right, title, and interest in the Services, software, interfaces, designs, documentation, trademarks, logos, workflows, templates provided by Firmivra, and related intellectual property, excluding Customer Data and third-party materials. No rights are granted except as expressly stated in these Terms.',
        },
      ],
    },
    {
      id: 'feedback',
      title: '29. Feedback',
      blocks: [
        {
          kind: 'paragraph',
          text: 'If you submit suggestions, ideas, or feedback about the Services, you grant Firmivra a worldwide, perpetual, irrevocable, royalty-free right to use and incorporate the feedback without restriction or compensation, provided Firmivra does not identify you publicly without permission.',
        },
      ],
    },
    {
      id: 'suspension',
      title: '30. Suspension',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra may suspend or restrict access when reasonably necessary to address nonpayment, security risk, suspected unauthorized access, unlawful use, abuse, legal requirements, material breach, or risk to other users or the Services. Where practical and legally permitted, Firmivra will provide notice and an opportunity to cure before non-emergency suspension. Emergency security suspensions may occur without prior notice.',
        },
      ],
    },
    {
      id: 'termination',
      title: '31. Termination',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Either party may terminate according to the applicable Order Form/Business Account Agreement. Firmivra may terminate for material breach that remains uncured after an applicable cure period, for unlawful/fraudulent use, or where continued service would violate law. Client Portal access may also be deactivated by the applicable Firm or Firmivra in accordance with portal-access rules.',
        },
      ],
    },
    {
      id: 'effect-of-termination',
      title: '32. Effect of Termination',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Upon termination, access rights end except for any permitted data-export/retrieval period. Payment obligations accrued before termination remain due. Sections that by their nature should survive will survive, including confidentiality, intellectual property, disclaimers, liability limits, indemnity, dispute provisions, audit/retention obligations, and rights relating to historical records.',
        },
      ],
    },
    {
      id: 'warranties-and-disclaimers',
      title: '33. Warranties and Disclaimers',
      blocks: [
        {
          kind: 'paragraph',
          text: 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICES, BETA FEATURES, CALCULATORS, TEMPLATES, RESOURCES, INTEGRATIONS, AND THIRD-PARTY CONTENT ARE PROVIDED "AS IS" AND "AS AVAILABLE." FIRMIVRA DISCLAIMS IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, AND ANY WARRANTY ARISING FROM COURSE OF DEALING OR USAGE OF TRADE, EXCEPT TO THE EXTENT A WARRANTY CANNOT LEGALLY BE DISCLAIMED. FIRMIVRA DOES NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED, ERROR-FREE, OR THAT ANY PARTICULAR TAX, ACCOUNTING, BUSINESS, PAYMENT, SECURITY, OR PROFESSIONAL OUTCOME WILL RESULT.',
        },
      ],
    },
    {
      id: 'limitation-of-liability',
      title: '34. Limitation of Liability',
      blocks: [
        {
          kind: 'paragraph',
          text: 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER FIRMIVRA NOR ITS AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, CONTRACTORS, OR LICENSORS WILL BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, BUSINESS, GOODWILL, DATA, OR BUSINESS INTERRUPTION, ARISING OUT OF OR RELATING TO THE SERVICES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.',
        },
        {
          kind: 'paragraph',
          text: "EXCEPT FOR LIABILITY THAT CANNOT BE LIMITED BY LAW OR AS OTHERWISE PROVIDED IN AN APPLICABLE DPA/ORDER FORM, FIRMIVRA'S AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THE SERVICES WILL NOT EXCEED THE FEES PAID OR PAYABLE BY THE APPLICABLE FIRM CUSTOMER TO FIRMIVRA FOR THE SERVICES GIVING RISE TO THE CLAIM DURING THE TWELVE (12) MONTHS BEFORE THE EVENT GIVING RISE TO LIABILITY. FOR A USER WHO HAS PAID NO FEES DIRECTLY TO FIRMIVRA, THE CAP WILL BE US$100.",
        },
      ],
    },
    {
      id: 'customer-indemnification',
      title: '35. Customer Indemnification',
      blocks: [
        {
          kind: 'paragraph',
          text: "To the extent permitted by law, a Firm Customer will defend, indemnify, and hold harmless Firmivra and its affiliates, officers, directors, employees, and agents from third-party claims, damages, liabilities, costs, and reasonable attorneys' fees arising from the Firm Customer's Customer Data, professional services, unlawful instructions, violation of law, violation of client rights, infringement caused by Customer Data, or material breach of these Terms. This obligation does not apply to the extent a claim is caused by Firmivra's own breach, gross negligence, or willful misconduct to the extent such exclusion is required by law.",
        },
      ],
    },
    {
      id: 'compliance-with-laws-sanctions-and-export-controls',
      title: '36. Compliance with Laws, Sanctions, and Export Controls',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You must comply with applicable laws and may not use the Services in violation of U.S. export controls, sanctions, anti-corruption, anti-money-laundering, or other applicable trade restrictions. You represent that you are not prohibited from using the Services under applicable sanctions/export laws.',
        },
      ],
    },
    {
      id: 'government-requests-and-legal-process',
      title: '37. Government Requests and Legal Process',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra may disclose information when legally required by valid process or where reasonably necessary to protect rights, safety, security, or prevent fraud/abuse. Where legally permitted and appropriate, Firmivra may attempt to direct government requests for Customer Data to the applicable Firm Customer or notify the Firm Customer so it may seek appropriate relief.',
        },
      ],
    },
    {
      id: 'notices',
      title: '38. Notices',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra may provide notices electronically through the Services, account email, portal notifications, or other reasonable methods. You are responsible for maintaining current contact information. Legal notices to Firmivra must be sent to the legal contact identified on the Firmivra Legal page or applicable Order Form.',
        },
      ],
    },
    {
      id: 'changes-to-these-terms',
      title: '39. Changes to These Terms',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra may update these Terms to reflect changes in law, security, Services, vendors, or business operations. We will update the "Last updated" date and provide legally or contractually required notice of material changes. Continued use after the effective date constitutes acceptance where permitted by law; if a change requires affirmative consent, we will obtain it.',
        },
      ],
    },
    {
      id: 'governing-law-and-venue',
      title: '40. Governing Law and Venue',
      blocks: [
        {
          kind: 'venue',
        },
        {
          kind: 'paragraph',
          text: 'Unless an applicable Order Form states otherwise, these Terms will be governed by the law specified above, excluding conflict-of-law principles, and disputes will be resolved in the specified venue, subject to any non-waivable rights under applicable law.',
        },
      ],
    },
    {
      id: 'miscellaneous',
      title: '41. Miscellaneous',
      blocks: [
        {
          kind: 'list',
          items: [
            'These Terms, the applicable Order Form, DPA, Business Account Agreement, and incorporated policies form the agreement between the parties regarding the Services.',
            'If there is a conflict, the Order Form controls over these Terms for commercial terms, and the DPA controls for covered data-processing obligations, unless expressly stated otherwise.',
            'Neither party may assign the agreement except as permitted in the Order Form or in connection with a merger, reorganization, or sale of substantially all relevant assets, subject to applicable law.',
            'Failure to enforce a provision is not a waiver. If a provision is unenforceable, it will be limited or severed to the minimum extent necessary and the remainder will continue in effect.',
            'Headings are for convenience only. "Including" means "including without limitation." Electronic records and signatures may satisfy writing/signature requirements where legally permitted.',
            'No third party is a beneficiary of these Terms except as expressly stated.',
          ],
        },
      ],
    },
    {
      id: 'contact',
      title: '42. Contact',
      blocks: [
        {
          kind: 'contact',
        },
      ],
    },
    {
      id: 'appendix-a-production-vendor-subprocessor-notice',
      title: 'Appendix A - Production Vendor / Subprocessor Notice',
      blocks: [
        {
          kind: 'table',
          head: ['Provider', 'Purpose', 'Terms / Notes'],
          rows: [
            [
              'Amazon Web Services (AWS)',
              'Cloud hosting, storage, database, networking, backup, logging/security, related infrastructure.',
              'AWS Service Terms / DPA apply to AWS processing as applicable.',
            ],
          ],
        },
      ],
    },
  ],
};
