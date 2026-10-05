import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SchoolOS",
  description: "Local foundation for the SchoolOS MVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
