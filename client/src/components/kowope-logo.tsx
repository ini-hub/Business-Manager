// Logo mark and wordmark shared by the landing page and the auth screens.
// Styles (.kp-logo*) live in pages/landing.css.
export function KowopeLogo() {
  return (
    <span className="kp-logo">
      <span className="kp-logo-mark" aria-hidden="true">K</span>
      <span className="kp-logo-word">Kowope</span>
    </span>
  );
}
