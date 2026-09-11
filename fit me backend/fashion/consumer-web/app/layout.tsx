import "./styles.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "FitMe", description: "AI virtual try-on for Indian fashion ecommerce" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

