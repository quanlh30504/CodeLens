import { signInMessage } from '@/lib/sign-in-messages';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const message = signInMessage(error);

  return (
    <main style={{ maxWidth: 420, margin: '10vh auto', padding: '0 16px' }}>
      <h1>CodeLens</h1>
      <p>Sign in with GitHub to connect your repositories.</p>
      {message ? (
        <p role="alert" style={{ color: '#b42318' }}>
          {message}
        </p>
      ) : null}
      {/* A plain link: the API redirects to GitHub. No token is ever handled in the browser. */}
      <a href="/api/auth/github/login">Sign in with GitHub</a>
    </main>
  );
}
