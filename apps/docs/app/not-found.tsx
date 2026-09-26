import Link from 'next/link';

export default function NotFound() {
  return <main className="not-found"><p className="eyebrow">404 / OFF THE CHART</p><h1>That page is missing.</h1><p>Head back to the documentation to find your next step.</p><Link href="/docs" className="primary-link">Open documentation →</Link></main>;
}
