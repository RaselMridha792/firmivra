import { PageShell } from './page-shell';

export type ComingSoonExperience = {
  name: string;
  summary: string;
  description: string;
  icon: 'workspace' | 'portal' | 'oversight';
};

const iconPaths = {
  workspace: 'M3 7h18v14H3z M3 7V3h7l3 4 M8 11v6 M12 11v6 M16 11v6',
  portal: 'M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7z M8 12l3 3 5-6',
  oversight: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
};

function Icon({ name }: { name: keyof typeof iconPaths }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d={iconPaths[name]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ComingSoon({
  brand,
  description,
  beta,
  experiences,
}: {
  brand: string;
  description: string;
  beta: { business: string; date: string; dateTime: string };
  experiences: readonly ComingSoonExperience[];
}) {
  return (
    <div className="fv-launch">
      <header className="fv-header fv-container">
        <a className="fv-wordmark" href="/" aria-label={`${brand} home`}>
          <span className="fv-brand-symbol" aria-hidden="true">
            f
          </span>
          {brand}
        </a>
        <a className="fv-nav-link" href="#platform">
          The platform <Icon name="arrow" />
        </a>
      </header>
      <PageShell className="fv-container">
        <section className="fv-hero" aria-labelledby="launch-title">
          <div className="fv-hero-copy">
            <span className="fv-launch-badge">
              <span aria-hidden="true" />
              Coming soon
            </span>
            <h1 id="launch-title">
              Your business.
              <br />
              Your clients.
              <br />
              <span>All connected.</span>
            </h1>
            <p className="fv-intro">{description}</p>
            <a className="fv-primary-link" href="#platform">
              Explore the platform <Icon name="arrow" />
            </a>
            <div className="fv-beta-note">
              <span className="fv-beta-line" aria-hidden="true" />
              <p>
                First beta planned for <time dateTime={beta.dateTime}>{beta.date}</time>
                <br />
                <span>{beta.business}</span>
              </p>
            </div>
          </div>
          <figure className="fv-concept" aria-label="Concept: three connected Firmivra experiences">
            <div className="fv-concept-header">
              <span>{brand}</span>
              <span>One connected platform</span>
            </div>
            <div className="fv-concept-grid">
              {experiences.map((experience) => (
                <div className="fv-concept-card" key={experience.name}>
                  <span className="fv-icon">
                    <Icon name={experience.icon} />
                  </span>
                  <strong>{experience.name}</strong>
                  <span>{experience.summary}</span>
                </div>
              ))}
            </div>
            <figcaption>
              <span aria-hidden="true" />
              Different spaces. One shared vision.
            </figcaption>
            <span className="fv-concept-orbit" aria-hidden="true" />
          </figure>
        </section>
        <section className="fv-platform" id="platform" aria-labelledby="platform-title">
          <div className="fv-section-heading">
            <p>BUILT AROUND YOUR BUSINESS</p>
            <h2 id="platform-title">One platform. Three experiences.</h2>
          </div>
          <div className="fv-feature-grid">
            {experiences.map((experience) => (
              <article className="fv-feature" key={experience.name}>
                <span className="fv-icon">
                  <Icon name={experience.icon} />
                </span>
                <h3>{experience.name}</h3>
                <p>{experience.description}</p>
              </article>
            ))}
          </div>
        </section>
      </PageShell>
      <footer className="fv-footer fv-container">
        <span>{brand}</span>
        <p>A new chapter in working together.</p>
        <span className="fv-footer-status">
          On the way
          <span aria-hidden="true" />
        </span>
      </footer>
    </div>
  );
}
