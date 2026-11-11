import type { MyPermissions, Role } from "@contracts";
import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ChevronDown,
  ClipboardList,
  FileText,
  GraduationCap,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Tags,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { cx } from "../components/ui";
import { ROLE_LABEL } from "../lib/labels";
import { hasAnyGrant } from "../lib/permissions";
import { useAuth, usePermissions } from "./auth";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  show: (role: Role, perms: MyPermissions | undefined) => boolean;
}

const admin = (role: Role) => role === "SUPER_ADMIN";
const staff = (role: Role, perms: MyPermissions | undefined) =>
  admin(role) || (role === "INSTRUCTOR" && hasAnyGrant(perms));

// The sidebar shows only what the role and grants allow (FRONTEND_GUIDE §4.1). Hiding is a convenience:
// every page is still protected by the server.
const NAV: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true, show: admin },
  // Instructors always have their own dashboard and submissions, grants or not.
  { to: "/instructor", label: "Dashboard", icon: LayoutDashboard, end: true, show: (role) => role === "INSTRUCTOR" },
  {
    to: "/submissions",
    label: "Submissions",
    icon: Inbox,
    show: (role) => role === "SUPER_ADMIN" || role === "INSTRUCTOR",
  },
  { to: "/admin/users", label: "Users", icon: Users, show: admin },
  { to: "/admin/groups", label: "Groups", icon: UsersRound, show: admin },
  { to: "/admin/instructors", label: "Instructors", icon: GraduationCap, show: admin },
  { to: "/admin/catalog", label: "Categories & tags", icon: Tags, show: admin },
  { to: "/exams", label: "Exams", icon: FileText, show: staff },
  {
    to: "/students",
    label: "Students",
    icon: Users,
    show: (role, perms) => role === "INSTRUCTOR" && hasAnyGrant(perms),
  },
  // Instructors with AUDIT_VIEW get a scoped audit view in phase B9 (NEXT_PLAN E18).
  { to: "/admin/audit", label: "Audit log", icon: ScrollText, show: admin },
  { to: "/student", label: "My exams", icon: ClipboardList, end: true, show: (role) => role === "STUDENT" },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { data: perms } = usePermissions();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu after navigating.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  if (!user) return null;
  const items = NAV.filter((i) => i.show(user.role, perms));

  return (
    <div className="min-h-screen md:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <aside className="border-b border-slate-800 bg-slate-900 text-slate-200 md:min-h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 font-bold text-white">
              X
            </div>
            <span className="font-bold text-white">Xpand Academy</span>
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm md:hidden"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            Menu
          </button>
        </div>
        <nav id="main-nav" aria-label="Main" className={cx("px-3 pb-4 md:block", menuOpen ? "block" : "hidden")}>
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                      isActive ? "bg-brand-700 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white",
                    )
                  }
                >
                  <item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-end gap-4 border-b border-slate-200 bg-white px-6 py-3">
          {/* The account menu: who is signed in, their password, and signing out. */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              className="flex items-center gap-3 rounded-lg px-2 py-1 text-right hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
              aria-label={`Account menu for ${user.fullName}`}
            >
              <span>
                <span className="block text-sm font-bold text-slate-800">{user.fullName}</span>
                <span className="block text-xs text-slate-600">{ROLE_LABEL[user.role]}</span>
              </span>
              <ChevronDown aria-hidden="true" className="h-4 w-4 text-slate-500" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 min-w-48 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg"
              >
                <DropdownMenu.Item asChild>
                  <Link
                    to="/account"
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-slate-700 outline-none data-[highlighted]:bg-slate-100"
                  >
                    <KeyRound aria-hidden="true" className="h-4 w-4" />
                    Change password
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-slate-200" />
                <DropdownMenu.Item
                  onSelect={() => void logout()}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-slate-700 outline-none data-[highlighted]:bg-slate-100"
                >
                  <LogOut aria-hidden="true" className="h-4 w-4" />
                  Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </header>
        <main id="main" className="mx-auto max-w-6xl p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
