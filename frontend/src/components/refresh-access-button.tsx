/**
 * Sends the person through GitHub authorization again so CodeLens re-reads which installations
 * (and, later, which roles) GitHub reports for them. It is a plain link: the API does the redirect,
 * and no token passes through the browser code.
 */
export function RefreshAccessButton() {
  return (
    <p>
      <a href="/api/me/refresh-access">Refresh access from GitHub</a> — use this if your access on GitHub
      changed and the list below looks out of date.
    </p>
  );
}
