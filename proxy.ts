import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Why Clerk over NextAuth: first-class App Router support, no DB session table,
// managed token rotation. auth() works in server components without extra config.

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
])

// Why explicit redirect not auth.protect(): Clerk v7 + Next.js 16 changed
// auth.protect() to trigger the new unauthorized() API, which shows a blank 404
// unless you define an unauthorized.tsx. Explicit redirect is reliable across versions.
//
// Why protect cron routes too: Vercel sets Authorization: Bearer ${CRON_SECRET}
// on cron invocations. We verify CRON_SECRET in each cron handler separately.
// Clerk middleware here ensures no unauthenticated traffic reaches ANY route.
export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.redirect(new URL('/sign-in', request.url))
    }
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
