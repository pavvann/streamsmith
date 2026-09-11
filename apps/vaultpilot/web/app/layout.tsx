import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {Fraunces, JetBrains_Mono, Source_Sans_3, Source_Serif_4} from 'next/font/google';
import './globals.css';

/**
 * Four faces, each with one job, exposed to globals.css as CSS variables:
 *   Fraunces        every reading and every title (opsz + SOFT axes, so "SOFT" 30 is settable)
 *   Source Serif 4  prose: the rule, the disclosures, the notes
 *   Source Sans 3   labels, eyebrows, table cells
 *   JetBrains Mono  hashes, ids and the revocation command, and nothing else
 * Fallback stacks are declared here as well as in the CSS, so the page is readable before swap.
 */
const display = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  weight: 'variable',
  axes: ['SOFT', 'opsz'],
  variable: '--font-display',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

const serif = Source_Serif_4({
  subsets: ['latin'],
  display: 'swap',
  weight: 'variable',
  variable: '--font-serif',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

const sans = Source_Sans_3({
  subsets: ['latin'],
  display: 'swap',
  weight: 'variable',
  variable: '--font-sans',
  fallback: ['Helvetica Neue', 'Arial', 'sans-serif'],
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: 'variable',
  variable: '--font-mono',
  fallback: ['ui-monospace', 'Menlo', 'monospace'],
});

export const metadata: Metadata = {
  title: 'Vaultpilot — one screen',
  description:
    'The agent’s position, the two observed windows and their share-value growth, the decision and the rule that produced it, the policy, the pipeline provenance, and how to revoke the agent.',
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en" className={`${display.variable} ${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
