import { Dashboard } from '../../../../../features/dashboard';
import { OwnerOnly } from '../../../../../components/workspace-context';
export default function Page() {
  return (
    <OwnerOnly>
      <Dashboard />
    </OwnerOnly>
  );
}
