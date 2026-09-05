import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NeoLearning — Mission Control',
  description:
    'An embedded engineering learning workspace. Explore the roadmap, study your notes, and think through code.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
