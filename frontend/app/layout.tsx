import type { Metadata } from "next";
import "./styles/base.css";
import "./styles/workspace.css";
import "./styles/public.css";

export const metadata: Metadata = {
  title: "SchoolOS",
  description: "A connected workspace for your school's people, records, and attendance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
