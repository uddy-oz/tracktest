import { useState } from "react";
import { analyticsAvailable, analyticsConsent, setAnalyticsConsent } from "../lib/analytics";
import "./AnalyticsPrivacy.css";

export default function AnalyticsPrivacy() {
  const [allowed, setAllowed] = useState(analyticsConsent);
  if (!analyticsAvailable()) return null;
  return (
    <footer className="analytics-privacy">
      <details>
        <summary>Analytics privacy</summary>
        <p>
          Optional analytics help StanZer understand which modes people play, whether they return,
          and how reliably audio starts. If you allow it, a random browser ID, gameplay events,
          and timing measurements go to PostHog in the US. We do not send names, email addresses,
          scores, private room details, or recordings.
        </p>
        <p>Analytics are off by default. You can change your choice here at any time without affecting play.</p>
        <label>
          <input type="checkbox" checked={allowed} onChange={event => setAllowed(setAnalyticsConsent(event.currentTarget.checked))} />
          Allow optional analytics
        </label>
        <p><a href="https://posthog.com/privacy" rel="noreferrer">PostHog privacy policy</a></p>
      </details>
    </footer>
  );
}
