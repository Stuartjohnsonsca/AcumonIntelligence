import { Suspense } from 'react';
import TwoFactorForm from './TwoFactorForm';

export default function TwoFactorPage() {
  return (
    <Suspense fallback={<div className="min-h-[calc(100vh-4rem)] flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>}>
      <TwoFactorForm />
    </Suspense>
  );
}
