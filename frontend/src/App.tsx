import { Button } from '@/components/ui/button';

export default function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">RecycleYoungs</h1>
      <p className="text-muted-foreground">개발 환경이 준비되었습니다.</p>
      <Button disabled>서비스 준비 중</Button>
    </main>
  );
}
