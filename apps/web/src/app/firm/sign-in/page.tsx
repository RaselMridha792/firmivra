import { SignIn } from '../../../components/auth/sign-in';

export default function FirmSignIn() {
  return (
    <SignIn
      site="firm"
      // Octavia's Oct 31 test blocker: a firm that has no account yet finds the application here.
      footer={
        <p data-testid="apply-link" className="mt-6 text-center text-base text-muted">
          New to Firmivra?{' '}
          <a className="text-link" href="/apply">
            Apply for a business account
          </a>
        </p>
      }
    />
  );
}
