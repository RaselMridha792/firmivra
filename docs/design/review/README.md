# Frontend visual review — 7 October 2026

All 50 supplied PNGs were inspected: 49 screen references and the Firmivra logo. Fahad owns the design system, firm workspace screens and shared staff authentication. The updated task plan moves Super Admin business screens to Tumit; the earlier implementation is retained here for his review. Begin Online and client-portal references inform the separate LVP theme. Those other developers' applications have not been replaced.

The five Super Admin compositions have been rebuilt as HTML controls and tables, using the supplied wordmarks and visible office photograph. Desktop captures use each source PNG's native dimensions. Compare the supplied reference on the left with the rendered app on the right:

| Screen | Side-by-side desktop | Loaded mobile capture |
| --- | --- | --- |
| Sign-in | [1536 × 1024 comparison](exact/admin-login-comparison.png) | [375px](exact/admin-login-mobile.png) |
| Dashboard | [1536 × 1024 comparison](exact/admin-dashboard-comparison.png) | [375px](exact/admin-dashboard-mobile.png) |
| Applications | [1672 × 941 comparison](exact/admin-applications-comparison.png) | [375px](exact/admin-applications-mobile.png) |
| Open application | [1536 × 1024 comparison](exact/admin-application-open-comparison.png) | [375px](exact/admin-application-open-mobile.png) |
| Approved firm | [1536 × 1024 comparison](exact/admin-firm-approved-comparison.png) | [375px](exact/admin-firm-approved-mobile.png) |

[Measured browser bounds](exact/bounds.json) accompany the images. Captures wait for headings, fonts and visible images; mobile capture fails if the document exceeds 375px. Tables scroll inside their container. Mobile navigation uses the shared modal with focus trapping, Escape dismissal and focus restoration. There are no mobile Super Admin reference PNGs: these are responsive adaptations of the supplied desktop composition.

## Deliberate content differences

These comparison captures use synthetic records, contact details use `.example`, and EIN is masked. Source personal contact details and unmasked identifiers are not copied into fixtures. Counters are reference examples only with a verified local session and `?preview=1`; live dashboard totals remain unavailable. Outside preview, the reused team/settings/tax-status APIs persist successful changes, and applications have live read-only records. Approval, document, message and invoice operations remain unavailable until their owner APIs are delivered. Firm workspace entry from Super Admin requires Rasel's support-access contract and owner grant.

Default sign-in has no development card; local quick access requires `?dev=1`. Super Admin has no added preview toolbar or footer. Local firm previews retain a development state selector for reviewing the ticket's required loading/empty/error/no-permission treatments.

## Remaining differences

These captures are review evidence, not a pixel-perfect claim. The login wave illustration is reconstructed as SVG; its gradients and curves still differ from the raster source. Cropped wordmarks retain some source background. SVG outline icons and browser font rasterization differ from the source illustration. Exact font files and original layered artwork were not supplied. Small differences in shadows, table row density and detail-card spacing remain visible in the comparisons.

The firm workspace has no matching mockups in the supplied folders. Its screens follow the written task specification and shared design system; they require design review. [Firm dashboard desktop](firm-dashboard-1440.png), [mobile](firm-dashboard-375.png), [clients desktop](firm-clients-1440.png) and [mobile](firm-clients-375.png) are browser-test captures. Complete all-screen review, Octavia's feedback and production smoke testing remain outstanding.

## Reproduce

Start local services using [the handoff](../../tasks/FAHAD-PROGRESS.md), then run sequentially:

```sh
pnpm --filter @firmivra/web exec node scripts/mockup-capture.mjs
powershell -NoProfile -File docs/design/review/create-comparisons.ps1
pnpm --filter @firmivra/web test:e2e
```

Run builds before browser tests. Do not run two Playwright suites concurrently: both write to the same test-results directory.
