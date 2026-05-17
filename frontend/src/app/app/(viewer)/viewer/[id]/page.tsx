import { ViewerScreen } from '@/components/viewer-screen';

export default async function ViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ViewerScreen mediaId={id} />;
}
