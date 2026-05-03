import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, Settings, Terminal, Variable, Key, FileCode2 } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  useEffect(() => {
    // Force dark mode
    document.documentElement.classList.add("dark");
  }, []);

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/workflows", label: "Workflows", icon: FileCode2 },
    { href: "/executions", label: "Executions", icon: Activity },
    { href: "/variables", label: "Variables", icon: Variable },
    { href: "/credentials", label: "Credentials", icon: Key },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Terminal className="h-6 w-6 text-primary mr-3" />
          <span className="font-bold text-lg tracking-tight">flowpython</span>
        </div>
        
        <nav className="flex-1 py-4 overflow-y-auto">
          <ul className="space-y-1 px-3">
            {navItems.map((item) => {
              const isActive = location === item.href || 
                              (item.href !== "/" && location.startsWith(item.href));
              
              return (
                <li key={item.href}>
                  <Link href={item.href}>
                    <div className={`flex items-center px-3 py-2 rounded-md transition-colors cursor-pointer ${
                      isActive 
                        ? "bg-primary/10 text-primary font-medium" 
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}>
                      <item.icon className={`h-5 w-5 mr-3 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                      {item.label}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        
        <div className="p-4 border-t border-border">
          <div className="flex items-center text-xs text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-green-500 mr-2"></div>
            System Online
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <div className={`flex-1 relative ${/\/workflows\/[^/]+\/edit/.test(location) || /\/executions\/[^/]+/.test(location) ? "overflow-hidden" : "overflow-y-auto p-8"}`}>
          {children}
        </div>
      </main>
    </div>
  );
}
