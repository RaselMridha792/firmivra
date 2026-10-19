import type { Metadata } from 'next';
import { GoalsAndMilestones } from '../_components/goals-screen';

export const metadata: Metadata = { title: 'Business advisory: Goals & milestones' };

export default function BusinessAdvisoryGoalsPage() {
  return <GoalsAndMilestones />;
}
