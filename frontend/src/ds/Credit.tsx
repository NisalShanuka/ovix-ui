import './credit.css';

// The builder's credit, shown small on every screen the panel serves.
export default function Credit({ className }: { className?: string }) {
  return (
    <p className={`ov-credit${className ? ` ${className}` : ''}`}>
      Developed by{' '}
      <a href="https://ntools.net" target="_blank" rel="noopener noreferrer">
        ntools.net
      </a>
    </p>
  );
}
