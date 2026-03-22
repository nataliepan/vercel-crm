import { redirect } from 'next/navigation'

// Why redirect not a page: the root URL has no content of its own.
// Authenticated users go straight to /dashboard.
// Unauthenticated users are caught by clerkMiddleware and sent to /sign-in.
export default function Home() {
  redirect('/dashboard')
}
