import { BrandLoader } from '../../../components/app-shell/brand-loader';

/** While a Super Admin page loads: the Firmivra loader inside the console's sidebar and header. */
export default function ConsoleLoading() {
  return <BrandLoader subtitle="Super Admin Portal" />;
}
