import reference from '../../../../../../../../../../docs/mockups/begin-online/Annual Intake Form 1.png';
import styles from './annual-tax.module.css';

const regions = {
  personal: [458, 238, 40, 40],
  filing: [940, 238, 46, 40],
  deductions: [453, 904, 40, 40],
  income: [943, 904, 40, 40],
  business: [85, 1198, 40, 40],
  spouse: [530, 286, 26, 24],
  dependents: [530, 612, 36, 26],
  returns: [37, 691, 34, 32],
  comments: [37, 1363, 32, 32],
} as const;
/** Decorative artwork clipped from the supplied reference, rather than recreated icons. */
export function AnnualArtwork({ region }: { region: keyof typeof regions }) {
  const [x, y, width, height] = regions[region];
  return (
    <svg
      className={styles.artwork}
      data-region={region}
      width={width}
      height={height}
      viewBox={`${x} ${y} ${width} ${height}`}
      aria-hidden="true"
    >
      <image href={reference.src} width={reference.width} height={reference.height} />
    </svg>
  );
}
