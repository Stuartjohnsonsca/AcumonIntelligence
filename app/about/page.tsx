import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About | Acumon Intelligence',
  description: 'Learn about Acumon Intelligence and our mission to transform audit and assurance.',
};

export default function AboutPage() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-4xl">
      {/* Welcome */}
      <div className="text-center mb-16">
        <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6">
          Welcome to{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-600">
            Acumon Intelligence
          </span>
        </h1>
        <p className="text-xl text-slate-600 leading-relaxed">
          We are on a mission to transform the way accounting and audit professionals work,
          bringing the power of artificial intelligence to every stage of the statutory audit
          and assurance process.
        </p>
      </div>

      {/* Content sections */}
      <div className="prose prose-slate max-w-none space-y-8">
        <div className="bg-blue-50 rounded-xl p-8 border border-blue-100">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">Our Mission</h2>
          <p className="text-slate-700 leading-relaxed">
            Acumon Intelligence provides cutting-edge AI tools designed specifically for the accounting,
            audit and assurance profession. We understand the complexity and responsibility that comes
            with statutory audit and assurance work, and we have built our platform to support
            professionals at every step.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
            <h3 className="text-xl font-semibold text-slate-900 mb-3">Statutory Audit</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Our statutory audit tools help firms streamline financial data extraction,
              document analysis, sample calculations, and financial statement checking.
              Save time, reduce errors, and deliver higher quality audit work.
            </p>
          </div>
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
            <h3 className="text-xl font-semibold text-slate-900 mb-3">Assurance</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              From ESG reporting to cybersecurity resilience and AI governance, our assurance
              tools help professionals navigate the growing complexity of modern assurance
              engagements with confidence.
            </p>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-8 border border-slate-200">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">Why Acumon Intelligence?</h2>
          <ul className="space-y-3 text-slate-700">
            <li className="flex items-start space-x-3">
              <span className="text-blue-600 font-bold mt-0.5">→</span>
              <span><strong>Built for professionals:</strong> Designed specifically for accounting and audit firms, not generic AI tools.</span>
            </li>
            <li className="flex items-start space-x-3">
              <span className="text-blue-600 font-bold mt-0.5">→</span>
              <span><strong>Secure and compliant:</strong> Enterprise-grade security with multi-factor authentication and role-based access controls.</span>
            </li>
            <li className="flex items-start space-x-3">
              <span className="text-blue-600 font-bold mt-0.5">→</span>
              <span><strong>Flexible subscriptions:</strong> Pay only for what you need, with subscription options scaled to your firm size and client portfolio.</span>
            </li>
            <li className="flex items-start space-x-3">
              <span className="text-blue-600 font-bold mt-0.5">→</span>
              <span><strong>Constantly evolving:</strong> Our platform grows with the profession, adding new tools as the landscape changes.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
