'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/import', label: 'Import' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/outreach', label: 'Outreach' },
]

export default function Nav() {
  const pathname = usePathname()

  return (
    <header className="bg-white border-b border-zinc-200">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="font-bold text-zinc-900 text-lg">Luma CRM</span>
          <nav className="flex items-center gap-1">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  pathname === href
                    ? 'bg-zinc-100 text-zinc-900'
                    : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <UserButton />
      </div>
    </header>
  )
}
