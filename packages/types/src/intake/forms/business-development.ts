import type { IntakeFormDefinition } from '../definition.js';
import { HEARD_ABOUT, MONTHS } from '../options.js';
import { address, f, has, is, opts, R, section, step } from './build.js';

// Business Development: docs/specs/NOTES-begin-online.md section 8, mockups `Development intake
// 1.png` to `Development Intake 4.png`. Single answers drawn as checkboxes are radios here. "How
// did you hear about us?" is asked once, on step 1 (step 3 asked it again), and the business name
// is asked on step 1 plus "a name in mind?" on step 2 (the mockup also asked "What is your
// business name?"; R11 question 3). The "began" timeframe list is a proposal for Octavia (R11
// question 7). The agreement, signature and confirmation email come from the firm's agreements
// (R14; R11 question 8).

const other = (field: string, key: string) =>
  f.text(key, 'Please specify', { placeholder: 'Please specify', showIf: has(field, ['OTHER']) });

export const BUSINESS_DEVELOPMENT_FORM: IntakeFormDefinition = {
  key: 'BUSINESS_DEVELOPMENT',
  version: 1,
  title: 'Business Development Intake Form',
  subtitle:
    "Let's turn your vision into a real business. Whether you're just getting started or ready to launch, we're here to help you build a solid foundation and position your business for long-term success.",
  steps: [
    step(
      'services',
      'Your Information & Services',
      [
        section(
          'contact',
          'Personal & Business Information',
          [
            f.text('fullName', 'Full Name', { ...R, placeholder: 'First and Last Name' }),
            f.phone('phone', 'Phone Number', R),
            f.email('email', 'Email Address', R),
            f.text('businessName', 'Business Name (if applicable)', {
              placeholder: 'Your Business Name',
            }),
            ...address('business', 'Business Address (if applicable)'),
          ],
          { subtitle: 'Tell us a little about yourself and your business.' },
        ),
        section(
          'services',
          'Business Development Services',
          [
            f.checkboxes(
              'services',
              'Select all the services you are interested in. You can choose more than one.',
              [
                {
                  value: 'FORMATION',
                  label: 'Business Formation',
                  help: 'Set up your business (LLC, Corporation, Partnership, etc.).',
                },
                {
                  value: 'EIN',
                  label: 'EIN Registration',
                  help: 'Get your Federal Employer Identification Number (EIN).',
                },
                {
                  // The mockup's "Georgia Registered Agent" is LVP's offer; a firm names its own
                  // state in its own version.
                  value: 'REGISTERED_AGENT_LOCAL',
                  label: 'Registered Agent in Our State',
                  help: 'We act as your official registered agent in our state.',
                },
                {
                  value: 'REGISTERED_AGENT_US',
                  label: 'Nationwide Registered Agent Services',
                  help: "We'll help you find reliable registered agent services in all 50 states.",
                },
                {
                  value: 'BUSINESS_PLAN',
                  label: 'Business Plan Creation',
                  help: 'Custom business plan to help you get organized and set a clear direction for growth.',
                },
                {
                  value: 'OPERATING_AGREEMENT',
                  label: 'Operating Agreement Creation',
                  help: 'Professional operating agreement for your LLC or partnership.',
                },
                {
                  value: 'LOGO',
                  label: 'Logo Creation',
                  help: 'Custom logo design for your brand.',
                },
                {
                  value: 'WEBSITE',
                  label: 'Website Development',
                  help: 'Professional website to establish your online presence.',
                },
                {
                  value: 'PRODUCT_DEVELOPMENT',
                  label: 'Product Development & Manufacturing Assistance',
                  help: 'Guidance with product development, manufacturing resources, and production strategies.',
                },
                {
                  value: 'SERVICE_DEVELOPMENT',
                  label: 'Service Development & Packaging',
                  help: 'Help with developing your services, creating service packages, and pricing strategies.',
                },
                {
                  value: 'BUDGETING',
                  label: 'Budgeting & Investment Planning',
                  help: 'Assistance with budgeting and planning your business investments for a strong foundation.',
                },
                {
                  value: 'RESOURCES',
                  label: 'Business Resource Support',
                  help: 'Ongoing guidance and connection to helpful business resources as needed.',
                },
              ],
              { ...R, cards: true },
            ),
            f.select('heardAbout', 'How Did You Hear About Us?', opts(HEARD_ABOUT)),
            f.textarea('notes', 'Additional Notes (Optional)', {
              placeholder: 'Tell us anything else we should know about your goals or needs.',
            }),
          ],
          { subtitle: "Select all the services you're interested in." },
        ),
      ],
      {
        subtitle: "Let's turn your vision into a real business.",
      },
    ),

    step(
      'details',
      'Business Details',
      [
        section(
          'overview',
          'Business Overview',
          [
            f.radio(
              'currentStatus',
              'What best describes your current status?',
              opts({
                STARTING: 'I am starting a new business',
                REGISTERED: 'I already have a registered business',
                EXPANDING: 'I am expanding an existing business',
                REBRANDING: 'I am rebranding or restructuring an existing business',
              }),
              R,
            ),
            f.radio(
              'businessType',
              'What type of business do you plan to form or operate?',
              opts({
                SOLE_PROPRIETORSHIP: 'Sole Proprietorship',
                PARTNERSHIP: 'Partnership',
                LLC: 'LLC (Limited Liability Company)',
                S_CORP: 'S-Corporation',
                C_CORP: 'C-Corporation',
                NONPROFIT: 'Nonprofit',
                FRANCHISE: 'Franchise',
                OTHER: 'Other (please specify)',
              }),
              R,
            ),
            f.text('businessTypeOther', 'Please specify', {
              ...R,
              showIf: is('businessType', 'OTHER'),
            }),
            f.yesNo('hasNameInMind', 'Do you already have a business name in mind?', R),
            f.text('proposedName', 'If yes, please provide the business name below.', {
              ...R,
              placeholder: 'Business Name',
              showIf: is('hasNameInMind', true),
            }),
          ],
          { subtitle: 'Tell us about your business and your goals.' },
        ),
        section(
          'accounting',
          'Accounting & Financial Structure',
          [
            f.radio(
              'accountingYear',
              'Which accounting method do you plan to use?',
              opts({
                CALENDAR: 'Calendar Year (January - December)',
                FISCAL: 'Fiscal Year (choose start month)',
                NOT_SURE: 'Not sure - I need help with this',
              }),
              R,
            ),
            f.select(
              'fiscalStartMonth',
              'If you select Fiscal Year, please choose your start month.',
              opts(MONTHS),
              {
                ...R,
                showIf: is('accountingYear', 'FISCAL'),
              },
            ),
            f.radio(
              'usesSoftware',
              'Do you currently use accounting or bookkeeping software?',
              opts({
                YES: 'Yes',
                NO: 'No',
                NOT_YET: 'Not yet, but I plan to',
                NEED_HELP: 'I need help choosing the right software',
              }),
              R,
            ),
            f.radio(
              'hasBookkeeper',
              'Do you currently have a bookkeeper or accountant?',
              opts({
                YES: 'Yes',
                NO: 'No',
                NOT_YET: 'Not yet, but I plan to',
                RECOMMENDATION: 'I need a recommendation',
              }),
              R,
            ),
          ],
          { subtitle: 'Let us know your preferences so we can guide you appropriately.' },
        ),
        section(
          'about',
          'About Your Business',
          [
            f.textarea('productsOrServices', 'Describe your products or services.', {
              ...R,
              placeholder: 'Tell us what you plan to offer (products, services, or both).',
            }),
            f.textarea('targetMarket', 'Who is your target market or ideal customer?', {
              ...R,
              placeholder:
                'Describe your target audience (e.g. individuals, businesses, industry, location).',
            }),
            f.textarea('unique', 'What makes your business unique?', {
              ...R,
              placeholder: 'Tell us what sets your business apart from others.',
            }),
            f.textarea('nearTermVision', 'Where do you see your business in 1-3 years?', {
              ...R,
              placeholder: 'Share your short-term goals and long-term vision.',
            }),
          ],
          { subtitle: 'Share details about what your business does and who you serve.' },
        ),
        section(
          'location',
          'Location & Registered Agent Information',
          [
            f.state('primaryState', 'In which state will you primarily operate your business?', R),
            f.states(
              'registeredAgentStates',
              'Do you need registered agent services in any other state(s)? (Select all that apply)',
            ),
          ],
          { subtitle: 'Let us know where your business will operate.' },
        ),
        section(
          'branding',
          'Branding & Design Preferences (If Applicable)',
          [
            f.text(
              'logoColors',
              'What colors would you like to include in your logo? (If applicable)',
              {
                placeholder: 'E.g. blue, gold, black, etc.',
              },
            ),
            f.textarea('colorsReason', 'Why do you like these colors?', {
              placeholder: 'Tell us what these colors represent or why they are important to you.',
            }),
          ],
          { subtitle: 'Tell us about your vision for your brand.' },
        ),
        section(
          'additional',
          'Additional Information',
          [
            f.textarea(
              'additionalInformation',
              'Is there anything else we should know to better support you?',
              {
                placeholder: 'Share any additional details, ideas, questions, or special requests.',
              },
            ),
          ],
          { subtitle: 'Is there anything else we should know to better support you?' },
        ),
      ],
      {
        subtitle:
          'Tell us more about your business so we can tailor the right support and resources for your success.',
      },
    ),

    step(
      'more',
      'Additional Information',
      [
        section(
          'goals',
          'Goals & Timeline',
          [
            f.textarea('mainGoals', 'What are your main goals for your business?', {
              ...R,
              placeholder:
                'e.g. launch a new brand, expand to new markets, build an online presence, develop a product, improve systems, etc.',
            }),
            f.select(
              'timeframe',
              'When would you like to begin?',
              opts({
                ASAP: 'As soon as possible',
                WITHIN_1_MONTH: 'Within 1 month',
                '1_TO_3_MONTHS': 'In 1 to 3 months',
                '3_TO_6_MONTHS': 'In 3 to 6 months',
                LATER: 'In more than 6 months',
                NOT_SURE: 'Not sure yet',
              }),
              R,
            ),
            f.textarea('longTermVision', 'Where do you see your business in 3-5 years?', {
              ...R,
              placeholder: 'Tell us about your long-term vision.',
            }),
          ],
          { subtitle: 'Help us understand your vision and timeline.' },
        ),
        section(
          'stage',
          'Current Stage & Needs',
          [
            f.radio(
              'stage',
              'What stage is your business currently in?',
              opts({
                IDEA: 'Idea / Planning Stage',
                GETTING_STARTED: 'Just Getting Started',
                OPERATING: 'Currently Operating',
                EXPANDING: 'Looking to Expand',
                REBRANDING: 'Rebranding / Restructuring',
                OTHER: 'Other (please specify)',
              }),
              R,
            ),
            f.text('stageOther', 'Please specify', {
              ...R,
              showIf: is('stage', 'OTHER'),
            }),
            f.checkboxes(
              'challenges',
              'What are your biggest challenges right now? (Select all that apply)',
              opts({
                STRUCTURE: 'Business structure / legal setup',
                BRANDING: 'Branding and marketing',
                WEBSITE: 'Website and online presence',
                PRODUCT: 'Product development / manufacturing',
                SERVICE: 'Service development / packaging / pricing',
                ORGANIZATION: 'Organization and systems',
                BUDGETING: 'Budgeting and financial planning',
                RESOURCES: 'Finding reliable resources / vendors',
                TIME: 'Time management',
                RESEARCH: 'Industry research / strategy',
                NOT_SURE: 'Not sure - I need guidance',
                OTHER: 'Other (please specify)',
              }),
            ),
            other('challenges', 'challengesOther'),
          ],
          { subtitle: 'Tell us where you are now so we can provide the right support.' },
        ),
        section(
          'questions',
          'Additional Details',
          [
            f.textarea('questions', 'Do you have any specific questions or requests?', {
              placeholder: 'Let us know how we can best support you.',
            }),
          ],
          { subtitle: 'Share any other information that will help us support you.' },
        ),
        section(
          'documents',
          'Document Uploads (Optional)',
          [
            f.upload('documents', 'Document Uploads (Optional)', {
              help: 'If you have any documents related to your business, you can upload them here. This is not required. Accepted file types: PDF, DOC, DOCX, JPG, PNG (Max 10 MB per file).',
              examples: [
                'Business plan (draft or completed)',
                'Existing operating agreement or formation documents',
                'Brand guidelines or logo files',
                'Product images or samples',
                'Website content or mockups',
                'Any other relevant information',
              ],
            }),
          ],
          {
            subtitle:
              'If you have any documents related to your business, you can upload them here.',
          },
        ),
      ],
      {
        subtitle:
          "You're almost there! Share a few more details so we can better understand your needs and prepare to support you.",
      },
    ),

    step(
      'review',
      'Review & Submit',
      [
        section('reviewNote', 'Review Your Information', [
          f.info(
            'reviewNote',
            'Review Your Information',
            'Please review each section below. Use Edit to change any answers before you read the service agreement and sign.',
          ),
        ]),
      ],
      { review: true, subtitle: 'Please review your information before you sign and submit.' },
    ),
  ],
};
