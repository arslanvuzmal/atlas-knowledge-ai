import { DemoClient } from '@/components/demo/demo-client';
import { isDemoMode } from '@/lib/env';

export default function DemoPage() {
  return <DemoClient demoMode={isDemoMode()} />;
}
