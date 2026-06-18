import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "House Miniature Prep",
  description: "Prepare Chief Architect STL/OBJ exports for 3D printing as house miniatures.",
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
