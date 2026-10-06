import { Invoices } from '../../../../features/communications';
import { OwnerOnly } from '../../../../components/workspace-context';
export default function Page() {
  return (
    <OwnerOnly>
      <Invoices />
    </OwnerOnly>
  );
}
