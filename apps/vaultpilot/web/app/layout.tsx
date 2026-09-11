import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vaultpilot — one screen',
  description:
    'The agent’s position, the two observed windows and their share-value growth, the decision and the rule that produced it, the policy, the pipeline provenance, and how to revoke the agent.',
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
