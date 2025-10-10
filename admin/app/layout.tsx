import "./globals.css";
import React from "react";

type Props = {
  children: React.ReactNode;
};

// Since we have a `[locale]` layout, a root layout file
// is required, even if it's just passing children through.
export default function RootLayout({ children }: Props) {
  return children;
}
