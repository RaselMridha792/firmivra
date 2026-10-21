import type { LegalDocumentText } from './legal-document';

/**
 * Firmivra's Privacy Policy, word for word from `docs/specs/Firmivra_Privacy_Policy.docx`.
 * Left out: the publication note, the bracketed contact and venue fields (the page fills them
 * from lib/company.ts), the providers not yet named, and the drafting appendices. Change the
 * text in the docx first, then here.
 */
export const PRIVACY_POLICY: LegalDocumentText = {
  title: 'Privacy Policy',
  subtitle:
    'Comprehensive Privacy Notice for the Firmivra Platform, Firm Workspace, Client Portal, and Related Services',
  effective: 'October 2, 2026',
  updated: 'October 2, 2026',
  sections: [
    {
      id: 'scope-and-who-we-are',
      title: '1. Scope and Who We Are',
      blocks: [
        {
          kind: 'paragraph',
          text: 'This Privacy Policy explains how Firmivra ("Firmivra," "we," "us," or "our") collects, uses, stores, discloses, protects, and otherwise processes personal information in connection with the Firmivra websites, applications, firm workspaces, Super Admin functions, client portals, integrations, communications, calculators, and related software and services (collectively, the "Services").',
        },
        {
          kind: 'paragraph',
          text: 'Firmivra is a software platform used by tax, accounting, bookkeeping, payroll, advisory, legal/financial, and other professional firms (each a "Firm Customer" or "Firm"). Firm Customers may use Firmivra to manage their staff, clients, leads, appointments, intake forms, documents, tax-return workflows, bookkeeping, payroll, invoices and payments, messages, tasks, reports, resources, and client portals.',
        },
        {
          kind: 'paragraph',
          text: "This Policy applies to Firm Customers, firm administrators and staff, client-portal users, applicants for a Firmivra business account, website visitors, and other individuals who interact directly with Firmivra. It does not replace a Firm Customer's own privacy notices or legal obligations to its clients.",
        },
      ],
    },
    {
      id: 'our-role-controller-business-and-processor-service-provider',
      title: '2. Our Role: Controller/Business and Processor/Service Provider',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra may act in different privacy roles depending on the processing activity. For data Firmivra collects for its own account administration, security, billing, support, product operations, legal compliance, and website management, Firmivra generally acts as a controller/business. For Client Data that a Firm Customer submits to or processes through the Services for the Firm\'s own professional services, Firmivra generally acts as a processor/service provider on behalf of the Firm Customer, subject to the applicable contract, Data Processing Addendum ("DPA"), and documented instructions.',
        },
        {
          kind: 'note',
          text: 'When Firmivra acts as a processor/service provider, the Firm Customer is responsible for determining the lawful purpose and legal basis for its client-data processing, providing required notices, obtaining required consents or authorizations, and responding to individual privacy requests. Firmivra will assist as required by contract and applicable law.',
        },
      ],
    },
    {
      id: 'personal-information-we-collect',
      title: '3. Personal Information We Collect',
      blocks: [
        {
          kind: 'table',
          head: ['Category', 'Examples'],
          rows: [
            [
              'Account and identity information',
              'Name, username, firm role, profile image/avatar, date of birth where provided, authentication identifiers, verification status, account type, portal status.',
            ],
            [
              'Contact information',
              'Email, phone number, mailing/business address, communication preferences, support contact details.',
            ],
            [
              'Business and professional information',
              'Legal business name, DBA, entity type, EIN/Tax ID, website, business address, practice type, staff/team information, professional credentials, licenses, PTIN/EFIN/CPA/EA/bar or other credential information where applicable.',
            ],
            [
              'Client and lead information',
              'Client/lead names, contact details, client IDs, service relationships, assigned staff, tags, statuses, notes, appointment and activity history.',
            ],
            [
              'Tax and financial information',
              'Tax returns and workpapers; W-2, 1099, K-1 and similar forms; income, deductions, expenses, payroll, bookkeeping and financial statements; bank/payment-related records; taxpayer identifiers; dependent information; notices/correspondence; filing and payment status.',
            ],
            [
              'Government identifiers and verification data',
              'SSN/TIN/EIN, driver license or government ID, credential numbers, tax identifiers, identity-verification information where necessary for the Services.',
            ],
            [
              'Documents and files',
              'Uploaded or shared PDFs, images, spreadsheets, contracts, engagement letters, licenses, formation documents, receipts, invoices, tax documents, business records, and other files.',
            ],
            [
              'Payment and billing information',
              'Invoice amounts, balances, payment status, transaction/provider references, billing contact information, receipts, payment method metadata. Full card/bank credentials should be handled by approved payment processors rather than stored in ordinary Firmivra fields.',
            ],
            [
              'Communications and notes',
              'Portal messages, email/SMS metadata, support communications, attachments, reminders, client-created notes, staff/internal notes according to access rules, communication history.',
            ],
            [
              'Appointments and calendar data',
              'Appointment type, dates/times, time zone, assigned staff, meeting method/location, availability, scheduling/rescheduling status, calendar integration identifiers.',
            ],
            [
              'Technical and usage information',
              'IP address, device/browser information, timestamps, session and authentication logs, pages/features used, errors, security events, integration and API logs, audit events.',
            ],
            [
              'Cookies and similar technologies',
              'Session cookies, authentication/security cookies, preferences, and analytics/diagnostic technologies where deployed.',
            ],
            [
              'Support and feedback',
              'Support tickets, troubleshooting data, product feedback, surveys, and related correspondence.',
            ],
            [
              'Sensitive personal information',
              'Depending on the Firm and service, the Services may process government identifiers, account-login information, financial information, tax-return information, precise identifiers, and other information treated as sensitive under applicable law.',
            ],
          ],
        },
      ],
    },
    {
      id: 'sources-of-personal-information',
      title: '4. Sources of Personal Information',
      blocks: [
        {
          kind: 'list',
          items: [
            'You, when you create an account, submit a form, upload a document, make a payment, send a message, schedule an appointment, contact support, or otherwise use the Services.',
            'Firm Customers, their administrators, staff, and authorized users.',
            'Client-portal users and authorized representatives acting on behalf of clients or businesses.',
            'Connected third-party services and integrations that you or a Firm Customer authorize, such as payment, calendar, email/SMS, e-signature, tax, bookkeeping, payroll, identity, or other business systems.',
            'Public or government sources where a Firm Customer or user intentionally imports or verifies public business/professional information.',
            'Automatically from devices, browsers, servers, security tools, and application logs when the Services are used.',
          ],
        },
      ],
    },
    {
      id: 'how-we-use-personal-information',
      title: '5. How We Use Personal Information',
      blocks: [
        {
          kind: 'list',
          items: [
            'Provide, operate, host, maintain, authenticate, and secure the Services.',
            'Create and manage Firm accounts, Firm Workspaces, staff accounts, client portals, and role-based permissions.',
            'Process and route appointments, intake forms, document uploads/requests, tax-return workflows, bookkeeping/payroll workflows, invoices/payments, messages, tasks, reminders, reports, and client-portal activity.',
            'Enable Firm Customers to provide tax, accounting, bookkeeping, payroll, advisory, and related professional services to their clients.',
            'Provide support, troubleshooting, training, onboarding, and product communications.',
            'Send transactional and operational notices, including account verification, security alerts, form/document requests, appointment notices, invoice/payment notices, workflow updates, and service communications.',
            'Prevent fraud, abuse, unauthorized access, malware, data loss, and other security threats; investigate incidents and enforce permissions.',
            'Monitor system health, diagnose errors, maintain audit logs, improve reliability, and develop product features using data consistent with our role and contractual/legal restrictions.',
            'Comply with legal obligations, lawful process, contractual requirements, tax/privacy/security rules, and enforce our agreements and rights.',
            'Create aggregated or de-identified analytics that do not reasonably identify an individual, subject to applicable law. We will not attempt to re-identify data that we maintain as de-identified except as permitted by law to test de-identification.',
          ],
        },
      ],
    },
    {
      id: 'tax-return-information-and-professional-services-data',
      title: '6. Tax Return Information and Professional-Services Data',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firm Customers that are tax return preparers may be subject to Internal Revenue Code Section 7216, Treasury Regulations under Section 7216, Section 6713, and other laws governing the use and disclosure of tax return information. Firmivra processes tax return information to provide the Services on behalf of Firm Customers and will not use or disclose such information for unrelated purposes except as instructed by the Firm Customer and legally permitted or required.',
        },
        {
          kind: 'paragraph',
          text: 'Firm Customers remain responsible for obtaining taxpayer consents or authorizations where required, determining whether an exception applies, and configuring their Firmivra use consistent with their professional and legal obligations.',
        },
      ],
    },
    {
      id: 'glba-ftc-safeguards-rule-and-taxpayer-data-security',
      title: '7. GLBA, FTC Safeguards Rule, and Taxpayer Data Security',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Certain Firm Customers, including tax preparation firms and other financial-service providers, may be subject to the Gramm-Leach-Bliley Act ("GLBA"), the FTC Safeguards Rule, IRS security guidance, state data-security laws, or professional security requirements. Firmivra is designed to support secure processing and may act as a service provider to covered Firms, but each Firm Customer remains responsible for determining its own regulatory obligations and maintaining required policies, risk assessments, training, incident response, and written information security program where applicable.',
        },
      ],
    },
    {
      id: 'how-we-disclose-or-share-personal-information',
      title: '8. How We Disclose or Share Personal Information',
      blocks: [
        {
          kind: 'note',
          text: "Firmivra does not disclose Personal Information to third parties for their own unrelated purposes. We disclose information only as reasonably necessary to provide, secure, support, integrate, or legally operate the Services; at a Firm Customer's direction; with the individual's authorization; or as required or permitted by law.",
        },
        {
          kind: 'table',
          head: ['Recipient / Category', 'Purpose and Limits'],
          rows: [
            [
              'Firm Customers and authorized users',
              'To provide the Services within the correct tenant, client, service, and permission scope.',
            ],
            [
              'Amazon Web Services (AWS)',
              'Cloud hosting and related infrastructure, which may include compute, storage, databases, backups, logging/security, and other cloud services. AWS processes customer content on our behalf subject to applicable AWS contractual/data-processing terms.',
            ],
            [
              'Payment processors',
              'To securely process payments, tokenize payment methods, confirm transactions, manage refunds/chargebacks, and provide payment status. Firmivra should receive only the payment data reasonably needed for the platform workflow.',
            ],
            [
              'Email/SMS/communications providers',
              'To send transactional, security, reminder, and authorized communication messages.',
            ],
            [
              'Calendar/video-meeting providers',
              'To synchronize availability, schedule/reschedule appointments, create meeting links, and display authorized meeting information.',
            ],
            [
              'E-signature, identity, tax, bookkeeping, payroll, or other integrations',
              'Only when enabled/authorized and only to perform the integrated workflow requested by the Firm Customer or user.',
            ],
            [
              'Security, monitoring, support, and infrastructure providers',
              'To protect, monitor, troubleshoot, support, and operate the Services.',
            ],
            [
              'Professional advisers',
              'Lawyers, accountants, auditors, insurers, and similar advisers where reasonably necessary and subject to confidentiality obligations.',
            ],
            [
              'Government, regulators, courts, or law enforcement',
              'When required by law, subpoena, court order, regulatory requirement, or to protect rights, safety, security, or prevent fraud/abuse.',
            ],
            [
              'Corporate transactions',
              'In connection with a merger, financing, acquisition, reorganization, sale of assets, or similar transaction, subject to appropriate confidentiality and notice requirements where legally required.',
            ],
          ],
        },
        {
          kind: 'paragraph',
          text: 'We will maintain and update our list of material subprocessors/service providers as our production vendor stack is finalized. AWS is currently identified as a cloud hosting/infrastructure provider. Additional vendors will be added to the production subprocessor/vendor list before or when they are used to process Personal Information.',
        },
      ],
    },
    {
      id: 'amazon-web-services-aws',
      title: '9. Amazon Web Services (AWS)',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra uses Amazon Web Services (AWS) for cloud hosting and related infrastructure. AWS provides cloud features that support customer control over data location, access, encryption, and logging, and AWS makes a Data Processing Addendum available through its Service Terms. Firmivra is responsible for configuring and using AWS services appropriately under the shared-responsibility model.',
        },
        {
          kind: 'paragraph',
          text: 'Firmivra may select AWS regions, services, backup configurations, encryption, key-management, access-control, logging, monitoring, and security features based on service needs, risk, customer requirements, and applicable law. Data may be processed in the United States and other locations as permitted by our contracts, customer instructions, AWS service configurations, and applicable transfer mechanisms.',
        },
      ],
    },
    {
      id: 'sale-sharing-for-targeted-advertising-and-marketing',
      title: '10. Sale, Sharing for Targeted Advertising, and Marketing',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra does not sell Personal Information for monetary consideration. Firmivra does not knowingly share Personal Information for cross-context behavioral advertising or targeted advertising as those terms are defined by applicable state privacy laws. If our practices materially change, we will update this Policy and provide opt-out mechanisms where required by law.',
        },
        {
          kind: 'paragraph',
          text: 'We do not use Client Data or tax return information for unrelated advertising. Marketing communications from Firmivra to Firm Customers may be sent in accordance with applicable law and communication preferences; transactional and security notices are not marketing.',
        },
      ],
    },
    {
      id: 'artificial-intelligence-and-automated-features',
      title: '11. Artificial Intelligence and Automated Features',
      blocks: [
        {
          kind: 'paragraph',
          text: 'If Firmivra introduces AI-assisted or automated features, we will use Customer Data only as permitted by contract, customer instructions, applicable law, and the applicable feature notice. Firmivra will not use Customer Data, Client Data, or tax return information to train generalized AI models for unrelated customers or advertising unless the applicable Firm Customer has expressly agreed in writing and such use is legally permitted. Automated reminders, routing, calculators, or workflow status updates are operational tools and should not be treated as professional advice or legally significant decisions unless specifically disclosed.',
        },
      ],
    },
    {
      id: 'cookies-and-similar-technologies',
      title: '12. Cookies and Similar Technologies',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra may use cookies and similar technologies that are necessary for authentication, security, session management, preferences, fraud prevention, and application functionality. If analytics or optional tracking technologies are deployed, Firmivra will provide notices and consent/opt-out controls as required by applicable law. Firmivra will honor legally required browser-based opt-out signals, such as Global Privacy Control, where applicable to our processing.',
        },
      ],
    },
    {
      id: 'data-retention',
      title: '13. Data Retention',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra retains Personal Information for as long as reasonably necessary to provide the Services, maintain the account or contractual relationship, comply with legal, tax, accounting, regulatory, professional, security, backup, dispute, and audit obligations, and enforce agreements. Retention may vary by data type, Firm Customer instructions, account status, configured retention settings, applicable law, and contractual requirements.',
        },
        {
          kind: 'paragraph',
          text: "When Firmivra acts as a processor/service provider, deletion and return of Client Data are governed by the Firm Customer's instructions, the applicable agreement/DPA, configured retention rules, and legal obligations. Deactivation of a portal or service does not necessarily require immediate deletion of historical records.",
        },
      ],
    },
    {
      id: 'security',
      title: '14. Security',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra uses administrative, technical, and organizational safeguards designed to protect Personal Information against unauthorized access, acquisition, use, alteration, disclosure, destruction, or loss. Safeguards may include encryption in transit and at rest where appropriate, access controls, least-privilege permissions, authentication and MFA capabilities, logging and audit trails, secure backups, monitoring, vulnerability and patch management, malware protections, incident response, vendor review, and employee/contractor confidentiality and security practices.',
        },
        {
          kind: 'paragraph',
          text: 'No system can guarantee absolute security. Users and Firm Customers are responsible for safeguarding credentials, using strong authentication, configuring roles and integrations properly, maintaining endpoint security, and promptly notifying Firmivra of suspected unauthorized access.',
        },
      ],
    },
    {
      id: 'security-incidents-and-breach-notification',
      title: '15. Security Incidents and Breach Notification',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra maintains processes for investigating suspected security incidents and will provide notifications to affected Firm Customers, individuals, regulators, or others as required by applicable law, contract, or regulatory obligations. Where Firmivra acts as a processor/service provider, Firmivra will notify the affected Firm Customer in accordance with the applicable DPA/contract so the Firm can meet its own legal obligations. Applicable breach-notification laws and sector-specific rules may impose additional timing or reporting requirements.',
        },
      ],
    },
    {
      id: 'your-privacy-rights',
      title: '16. Your Privacy Rights',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Depending on your location and the nature of our relationship, you may have rights to request access to, correction of, deletion of, portability of, or information about the use/disclosure of your Personal Information; to opt out of certain sales/sharing/targeted advertising; to limit certain uses of sensitive information; to withdraw consent where processing is based on consent; to object to or restrict certain processing; and to appeal a denied request where applicable.',
        },
        {
          kind: 'paragraph',
          text: 'When Firmivra holds your data only as a processor/service provider for a Firm Customer, please direct your request to that Firm Customer. We will assist the Firm Customer as required by law and contract. Firmivra may need to verify your identity before fulfilling a request and may deny or limit a request where permitted by law, including when retention is legally required.',
        },
      ],
    },
    {
      id: 'u-s-state-privacy-rights',
      title: '17. U.S. State Privacy Rights',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Residents of states with comprehensive privacy laws may have rights that vary by jurisdiction. Where such laws apply to Firmivra as a business/controller, Firmivra will provide the required rights and request methods. These may include rights to know/access, delete, correct, obtain a portable copy, opt out of sale/targeted advertising/profiling in furtherance of decisions with legal or similarly significant effects, limit certain sensitive-data processing, and appeal a denied request. We will not discriminate against you for exercising legally protected privacy rights.',
        },
      ],
    },
    {
      id: 'california-privacy-notice',
      title: '18. California Privacy Notice',
      blocks: [
        {
          kind: 'paragraph',
          text: 'If the California Consumer Privacy Act, as amended (CCPA), applies to Firmivra\'s processing as a "business," California residents may have rights to know/access, delete, correct, opt out of sale or sharing, limit certain uses/disclosures of sensitive personal information, and receive non-discriminatory treatment. Firmivra does not sell Personal Information and does not knowingly share Personal Information for cross-context behavioral advertising.',
        },
        {
          kind: 'table',
          head: ['CCPA Category (Illustrative)', 'Collected?', 'Business Purpose / Disclosure'],
          rows: [
            [
              'Identifiers',
              'Yes',
              'Account, authentication, client/firms records, support, security; disclosed to service providers as necessary.',
            ],
            [
              'Customer records / contact data',
              'Yes',
              'Account, firm/client management, billing, support, operations.',
            ],
            [
              'Protected-classification information',
              'Possibly, if contained in client/tax documents',
              'Processed only as necessary for customer-directed professional-service workflows and legal obligations.',
            ],
            [
              'Commercial information',
              'Yes',
              'Subscription, services, invoices, payment history, product usage.',
            ],
            [
              'Internet/network activity',
              'Yes',
              'Security, authentication, diagnostics, system operations, fraud prevention.',
            ],
            [
              'Geolocation',
              'Limited / approximate unless feature requires more',
              'Security, fraud prevention, region/time-zone/appointment functionality; precise location is not required unless specifically disclosed.',
            ],
            [
              'Professional/employment information',
              'Yes',
              'Firm applications, staff roles, payroll/bookkeeping/client records, credentials.',
            ],
            [
              'Sensitive personal information',
              'Yes, depending on service',
              'Tax/financial identifiers, login credentials, government identifiers and similar information processed to provide and secure the Services.',
            ],
            [
              'Inferences',
              'Limited',
              'Operational analytics and security signals; not sold or shared for cross-context behavioral advertising.',
            ],
          ],
        },
        {
          kind: 'paragraph',
          text: 'To exercise applicable California rights, use the privacy-request method identified in the Contact Us section. Firmivra may verify identity and authority as permitted by law. Authorized agents may submit requests where permitted, subject to verification requirements.',
        },
      ],
    },
    {
      id: 'international-privacy-and-data-transfers',
      title: '19. International Privacy and Data Transfers',
      blocks: [
        {
          kind: 'paragraph',
          text: 'If Firmivra offers Services to individuals or organizations in jurisdictions with international data-protection laws, such as the EEA, United Kingdom, or Switzerland, Firmivra will apply the relevant controller/processor obligations as applicable to the processing. Where cross-border transfer safeguards are required, Firmivra may rely on contractual and legal transfer mechanisms such as Standard Contractual Clauses, the UK Addendum, adequacy decisions, or other approved mechanisms. Firm Customers are responsible for determining whether their own use of Firmivra requires additional transfer terms or local notices.',
        },
      ],
    },
    {
      id: 'children-and-dependents',
      title: '20. Children and Dependents',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Firmivra is not directed to children under 13, and Firmivra does not knowingly allow children under 13 to create independent platform accounts. Adult taxpayers, businesses, and Firm Customers may provide information about dependents or minors when necessary for tax or professional services. In those circumstances, Firmivra processes the information on behalf of the Firm Customer and subject to applicable law, contractual instructions, and access controls.',
        },
      ],
    },
    {
      id: 'third-party-websites-and-integrations',
      title: '21. Third-Party Websites and Integrations',
      blocks: [
        {
          kind: 'paragraph',
          text: "The Services may link to or integrate with third-party websites, services, or government resources. Once you leave Firmivra or authorize a third-party integration, that third party's privacy practices may apply. Firmivra is not responsible for independent third-party privacy practices. We encourage users to review third-party policies before providing information.",
        },
      ],
    },
    {
      id: 'changes-to-this-privacy-policy',
      title: '22. Changes to this Privacy Policy',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We may update this Privacy Policy to reflect changes in law, technology, vendors, security practices, or the Services. We will update the "Last updated" date and provide additional notice where required by law or where changes are materially adverse. Material changes will apply prospectively unless otherwise permitted by law.',
        },
      ],
    },
    {
      id: 'contact-us-and-privacy-requests',
      title: '23. Contact Us and Privacy Requests',
      blocks: [
        {
          kind: 'contact',
        },
        {
          kind: 'paragraph',
          text: 'Privacy requests, security concerns, and questions about this Policy should be submitted through the privacy-contact methods published by Firmivra. If your information is controlled by a Firm Customer, Firmivra may direct you to that Firm Customer or coordinate with it to fulfill the request.',
        },
      ],
    },
    {
      id: 'appendix-a-subprocessor-service-provider-list-launch-version',
      title: 'Appendix A - Subprocessor / Service Provider List (Launch Version)',
      blocks: [
        {
          kind: 'table',
          head: ['Provider', 'Category / Purpose', 'Status'],
          rows: [
            [
              'Amazon Web Services (AWS)',
              'Cloud hosting, storage, databases, backup, logging/security, and related infrastructure.',
              'IDENTIFIED FOR LAUNCH',
            ],
          ],
        },
      ],
    },
  ],
};
