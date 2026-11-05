import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <h2 className="text-2xl font-bold text-navy-900 mb-2">Page Not Found</h2>
      <p className="text-sm text-navy-600 mb-4">The page you requested could not be found.</p>
      <Link href="/" className="btn-primary text-xs">
        Return Home
      </Link>
    </div>
  );
}

