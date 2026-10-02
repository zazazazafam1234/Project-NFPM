import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./theme.css";
import "./globals.css";
import { PageTracker } from "./components/PageTracker";
import { SupportButton } from "./components/SupportButton";
import { ResellerBankPrompt } from "./components/ResellerBankForm";
import { SessionProvider } from "./providers";

const notoSansThai = Noto_Sans_Thai({
  variable: "--font-noto-thai",
  subsets: ["thai", "latin"],
});

export const metadata: Metadata = {
  title: "Fast Movie | เลือกแพ็กเกจความบันเทิงของคุณ",
  description: "เลือกแพ็กเกจความบันเทิงที่เหมาะกับคุณ พร้อมบริการดูแลจากแอดมิน",
  icons: {
    icon: [
      { url: "/fastmovie-logo.png?v=2", type: "image/png", sizes: "any" },
    ],
    shortcut: ["/fastmovie-logo.png?v=2"],
    apple: [{ url: "/fastmovie-logo.png?v=2", type: "image/png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${notoSansThai.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <SessionProvider>
          {children}
          <ResellerBankPrompt />
        </SessionProvider>
        <PageTracker />
        <SupportButton />
      </body>
    </html>
  );
}
