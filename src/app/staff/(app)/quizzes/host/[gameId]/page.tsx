import { QuizHost } from '@/components/staff/papers/QuizHost';

/* The class screen sits inside the staff shell (for the session and the
   toasts) but covers it completely: .qh-wrap is fixed, full screen. */
export default async function Page({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <QuizHost gameId={Number(gameId)} />;
}
