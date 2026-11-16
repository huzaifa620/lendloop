import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import ConvexClientProvider from "./ConvexClientProvider";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LendLoop",
  description: "Borrow what you need. Lend what you don't.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ClerkProvider>
          <ConvexClientProvider>
            <header className="border-b border-line">
              <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
                <Link href="/" className="font-semibold tracking-tight">
                  Lend<span className="text-accent">Loop</span>
                </Link>
                <Suspense>
                  <Show when="signed-out">
                    <SignInButton mode="modal">
                      <button className="btn">Sign in</button>
                    </SignInButton>
                  </Show>
                  <Show when="signed-in">
                    <UserButton />
                  </Show>
                </Suspense>
              </div>
            </header>
            <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
