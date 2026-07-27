import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Atlas Knowledge AI',
    template: '%s · Atlas Knowledge AI',
  },
  description:
    'A secure RAG knowledge platform that turns approved documents, websites, policies and manuals into a searchable conversational assistant with source citations, access controls, analytics and human escalation.',
  applicationName: 'Atlas Knowledge AI',
  authors: [{ name: 'Arslan Vuzmal Lone' }],
  creator: 'Arslan Vuzmal Lone',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Atlas Knowledge AI',
    description:
      'Secure RAG knowledge assistant with source-grounded answers, role-based access control, and human escalation.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#12141c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas antialiased">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
