import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Why Clerk over NextAuth: Clerk has first-class Next.js App Router support —
// auth() works in server components, clerkMiddleware() handles edge cases like
// redirecting unauthenticated users without a DB session table.
// No token rotation config, no adapter setup, no session table to maintain.

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
])

// Why protect cron routes too: Vercel sets Authorization: Bearer ${CRON_SECRET}
// on cron invocations. We verify CRON_SECRET in each cron handler separately.
// Clerk middleware here ensures no unauthenticated traffic reaches ANY route
// including crons — double-layered protection.
export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
