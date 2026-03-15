import Link from 'next/link';
import { ArrowRight, BarChart3, FileSearch, Shield, Users, CheckCircle, Zap, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
        <div className="relative container mx-auto px-4 py-24 md:py-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center space-x-2 bg-blue-500/20 border border-blue-400/30 rounded-full px-4 py-1.5 text-sm text-blue-300 mb-6">
              <Zap className="h-3.5 w-3.5" />
              <span>AI-powered audit and assurance tools</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
              Welcome to{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
                Acumon Intelligence
              </span>
            </h1>
            <p className="text-xl text-slate-300 mb-8 leading-relaxed">
              Transforming the way accounting and audit professionals work. Our intelligent platform delivers
              cutting-edge AI tools for statutory audit, financial data extraction, and comprehensive assurance services.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button size="lg" className="bg-blue-600 hover:bg-blue-500 text-white" asChild>
                <Link href="/about">
                  Learn More <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="border-slate-400 text-white hover:bg-white/10" asChild>
                <Link href="/login">Get Started</Link>
              </Button>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* Features Grid */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Intelligent tools for modern audit
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              From statutory audit to assurance, our platform covers every stage of the professional services workflow.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: FileSearch,
                title: 'Financial Data Extraction',
                description: 'Automatically extract and structure financial data from any document format with high accuracy.',
                category: 'Statutory Audit',
              },
              {
                icon: BarChart3,
                title: 'Financial Statements Checker',
                description: 'Validate and verify financial statements against accounting standards with AI-powered analysis.',
                category: 'Statutory Audit',
              },
              {
                icon: Shield,
                title: 'Cybersecurity Resilience',
                description: 'Assess and report on organisational cybersecurity posture with comprehensive AI-driven insights.',
                category: 'Assurance',
              },
              {
                icon: Globe,
                title: 'ESG & Sustainability',
                description: 'Streamline ESG reporting and assurance with intelligent data collection and analysis tools.',
                category: 'Assurance',
              },
              {
                icon: Users,
                title: 'Workforce & Talent Risk',
                description: 'Identify and assess workforce risks with structured assurance frameworks powered by AI.',
                category: 'Assurance',
              },
              {
                icon: CheckCircle,
                title: 'Agentic AI & Governance',
                description: 'Evaluate AI governance frameworks and ensure responsible use of artificial intelligence.',
                category: 'Assurance',
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="group p-6 rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-lg transition-all duration-200 bg-white"
              >
                <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center mb-4 group-hover:bg-blue-100 transition-colors">
                  <feature.icon className="h-6 w-6 text-blue-600" />
                </div>
                <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">{feature.category}</span>
                <h3 className="text-lg font-semibold text-slate-900 mt-1 mb-2">{feature.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-blue-700 to-blue-600 text-white">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to transform your audit process?</h2>
          <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
            Join leading accounting firms already using Acumon Intelligence to deliver better outcomes.
          </p>
          <Button size="lg" className="bg-white text-blue-700 hover:bg-blue-50" asChild>
            <Link href="/login">Start today <ArrowRight className="ml-2 h-5 w-5" /></Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
