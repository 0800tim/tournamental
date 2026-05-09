/**
 * "Built in public" callout — Apache 2.0, contributors share platform
 * revenue via Drips Network. Single GitHub-styled CTA.
 */

export function OpenSourceCallout() {
  return (
    <div className="wc-oss">
      <h2>Built in public.</h2>
      <p>
        VTourn is open source under Apache 2.0. Contributors share platform
        revenue via Drips Network. Read the spec, file an issue, ship a
        feature — every commit is verifiable.
      </p>
      <a
        className="wc-gh-btn"
        href="https://github.com/0800tim/vtorn"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Star and watch the VTourn repo on GitHub"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2 0 1.9 1.2 1.9 1.2 1.1 1.9 2.9 1.4 3.6 1 .1-.8.4-1.4.8-1.7-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.7.8 1.2 1.9 1.2 3.2 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.2.8 2.3v3.4c0 .3.2.7.8.6A12 12 0 0 0 12 .3z" />
        </svg>
        Star + Watch on GitHub
      </a>
    </div>
  );
}
